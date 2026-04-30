use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    program::{invoke, invoke_signed},
    program_pack::Pack,
    system_instruction,
};
use anchor_spl::token::spl_token;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

#[cfg(feature = "localnet-program-id")]
declare_id!("HktRmDZBsEgpHCuEkzGMsy2RQdsWzMzyNxf7hHHvFkMU");

#[cfg(not(feature = "localnet-program-id"))]
declare_id!("HcK2u8Ko7L8ZXPRSUAC7ZiDYyT9LuRS383KChtzhkBkd");

const CONFIG_SEED: &[u8] = b"config";
const MARKET_SEED: &[u8] = b"market";
const VAULT_SEED: &[u8] = b"vault";
const AGENT_COMMITMENT_SEED: &[u8] = b"agent_commitment";
const POSITION_SEED: &[u8] = b"position";
const MAX_FEE_BPS: u16 = 10_000;

#[program]
pub mod exoduze_prediction_market {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        oracle_authority: Pubkey,
        treasury_authority: Pubkey,
        fee_bps: u16,
    ) -> Result<()> {
        validate_fee_bps(fee_bps)?;

        let config = &mut ctx.accounts.config;
        config.admin_authority = ctx.accounts.admin.key();
        config.oracle_authority = oracle_authority;
        config.treasury_authority = treasury_authority;
        config.fee_bps = fee_bps;
        config.paused = false;
        config.bump = ctx.bumps.config;

        Ok(())
    }

    pub fn update_oracle_authority(
        ctx: Context<UpdateOracleAuthority>,
        oracle_authority: Pubkey,
    ) -> Result<()> {
        ctx.accounts.config.oracle_authority = oracle_authority;
        Ok(())
    }

    pub fn update_treasury_authority(
        ctx: Context<UpdateTreasuryAuthority>,
        treasury_authority: Pubkey,
    ) -> Result<()> {
        ctx.accounts.config.treasury_authority = treasury_authority;
        Ok(())
    }

    pub fn update_fee_bps(ctx: Context<UpdateFeeBps>, fee_bps: u16) -> Result<()> {
        validate_fee_bps(fee_bps)?;
        ctx.accounts.config.fee_bps = fee_bps;
        Ok(())
    }

    pub fn pause(ctx: Context<TogglePause>) -> Result<()> {
        ctx.accounts.config.paused = true;
        Ok(())
    }

    pub fn unpause(ctx: Context<TogglePause>) -> Result<()> {
        ctx.accounts.config.paused = false;
        Ok(())
    }

    pub fn create_market(
        ctx: Context<CreateMarket>,
        market_id_hash: [u8; 32],
        opens_at: i64,
        join_deadline_at: i64,
        decision_cutoff_at: i64,
        closes_at: i64,
        resolves_at: i64,
    ) -> Result<()> {
        require_not_paused(&ctx.accounts.config)?;
        validate_market_schedule(
            opens_at,
            join_deadline_at,
            decision_cutoff_at,
            closes_at,
            resolves_at,
        )?;

        create_vault_token_account(
            &ctx.accounts.authority.to_account_info(),
            &ctx.accounts.vault.to_account_info(),
            &ctx.accounts.settlement_mint.to_account_info(),
            &ctx.accounts.token_program.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            ctx.accounts.market.key(),
            ctx.bumps.vault,
        )?;

        let market = &mut ctx.accounts.market;
        market.market_id_hash = market_id_hash;
        market.authority = ctx.accounts.authority.key();
        market.oracle_authority = ctx.accounts.config.oracle_authority;
        market.settlement_mint = ctx.accounts.settlement_mint.key();
        market.vault = ctx.accounts.vault.key();
        market.opens_at = opens_at;
        market.join_deadline_at = join_deadline_at;
        market.decision_cutoff_at = decision_cutoff_at;
        market.closes_at = closes_at;
        market.resolves_at = resolves_at;
        market.status = MarketStatus::Active;
        market.outcome = None;
        market.total_yes_stake = 0;
        market.total_no_stake = 0;
        market.total_stake = 0;
        market.bump = ctx.bumps.market;

        Ok(())
    }

    pub fn cancel_market(ctx: Context<CancelMarket>) -> Result<()> {
        let authority = ctx.accounts.authority.key();
        let market = &mut ctx.accounts.market;

        require!(
            market.status == MarketStatus::Active,
            ExoduzeError::MarketAlreadyClosed
        );
        require!(
            authority == market.authority || authority == ctx.accounts.config.admin_authority,
            ExoduzeError::Unauthorized
        );

        market.status = MarketStatus::Cancelled;
        market.outcome = None;

        Ok(())
    }

    pub fn commit_agent_decision(
        ctx: Context<CommitAgentDecision>,
        agent_id_hash: [u8; 32],
        snapshot_hash: [u8; 32],
        prompt_hash: [u8; 32],
        config_hash: [u8; 32],
        reason_hash: [u8; 32],
        decision_side: Side,
    ) -> Result<()> {
        require_not_paused(&ctx.accounts.config)?;

        let now = Clock::get()?.unix_timestamp;
        let market = &ctx.accounts.market;
        require!(
            market.status == MarketStatus::Active,
            ExoduzeError::MarketNotActive
        );
        require!(now >= market.opens_at, ExoduzeError::MarketNotOpen);
        require!(
            now <= market.decision_cutoff_at,
            ExoduzeError::MarketDeadlinePassed
        );

        let commitment = &mut ctx.accounts.agent_commitment;
        upsert_agent_commitment(
            commitment,
            market.key(),
            ctx.accounts.agent_authority.key(),
            agent_id_hash,
            snapshot_hash,
            prompt_hash,
            config_hash,
            reason_hash,
            decision_side,
            now,
            ctx.bumps.agent_commitment,
        )?;

        Ok(())
    }

    pub fn open_position(ctx: Context<OpenPosition>, stake_amount: u64) -> Result<()> {
        require_not_paused(&ctx.accounts.config)?;
        require!(stake_amount > 0, ExoduzeError::InvalidStakeAmount);

        let now = Clock::get()?.unix_timestamp;
        let market = &mut ctx.accounts.market;
        require!(
            market.status == MarketStatus::Active,
            ExoduzeError::MarketNotActive
        );
        require!(now >= market.opens_at, ExoduzeError::MarketNotOpen);
        require!(
            now <= market.join_deadline_at,
            ExoduzeError::MarketDeadlinePassed
        );
        require!(
            ctx.accounts.agent_commitment.market == market.key(),
            ExoduzeError::InvalidAgentCommitment
        );

        let position = &mut ctx.accounts.position;
        let position_is_new = position.market == Pubkey::default();

        if position_is_new {
            position.market = market.key();
            position.user = ctx.accounts.user.key();
            position.agent_commitment = ctx.accounts.agent_commitment.key();
            position.side = ctx.accounts.agent_commitment.decision_side;
            position.stake_amount = 0;
            position.claimed_amount = 0;
            position.status = PositionStatus::Open;
            position.bump = ctx.bumps.position;
        } else {
            require!(
                position.market == market.key()
                    && position.user == ctx.accounts.user.key()
                    && position.agent_commitment == ctx.accounts.agent_commitment.key(),
                ExoduzeError::InvalidPosition
            );
            require!(
                position.status == PositionStatus::Open,
                ExoduzeError::PositionAlreadyClaimed
            );
            require!(
                position.side == ctx.accounts.agent_commitment.decision_side,
                ExoduzeError::InvalidPosition
            );
        }

        transfer_from_user_to_vault(
            &ctx.accounts.token_program,
            &ctx.accounts.user_token_account,
            &ctx.accounts.vault,
            &ctx.accounts.user,
            stake_amount,
        )?;

        position.stake_amount = position
            .stake_amount
            .checked_add(stake_amount)
            .ok_or(ExoduzeError::MathOverflow)?;

        match position.side {
            Side::Yes => {
                market.total_yes_stake = market
                    .total_yes_stake
                    .checked_add(stake_amount)
                    .ok_or(ExoduzeError::MathOverflow)?;
            }
            Side::No => {
                market.total_no_stake = market
                    .total_no_stake
                    .checked_add(stake_amount)
                    .ok_or(ExoduzeError::MathOverflow)?;
            }
        }

        market.total_stake = market
            .total_stake
            .checked_add(stake_amount)
            .ok_or(ExoduzeError::MathOverflow)?;

        Ok(())
    }

    pub fn resolve_market(ctx: Context<ResolveMarket>, outcome: Option<Side>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let market = &mut ctx.accounts.market;

        require!(
            market.status == MarketStatus::Active,
            ExoduzeError::MarketAlreadyClosed
        );
        require!(
            now >= resolve_not_before(market),
            ExoduzeError::MarketNotClosed
        );

        match outcome {
            Some(side) => {
                market.status = MarketStatus::Resolved;
                market.outcome = Some(side);
            }
            None => {
                market.status = MarketStatus::Cancelled;
                market.outcome = None;
            }
        }

        Ok(())
    }

    pub fn claim_payout(ctx: Context<ClaimPayout>) -> Result<()> {
        let market = &ctx.accounts.market;
        let position = &mut ctx.accounts.position;

        require!(
            position.market == market.key() && position.user == ctx.accounts.user.key(),
            ExoduzeError::InvalidPosition
        );
        require!(
            position.status == PositionStatus::Open,
            ExoduzeError::PositionAlreadyClaimed
        );

        match market.status {
            MarketStatus::Cancelled | MarketStatus::Invalid => {
                let refund_amount = position.stake_amount;
                if refund_amount > 0 {
                    transfer_from_vault(
                        ctx.program_id,
                        &ctx.accounts.token_program,
                        &ctx.accounts.market,
                        &ctx.accounts.vault,
                        &ctx.accounts.user_token_account,
                        refund_amount,
                    )?;
                }

                position.claimed_amount = refund_amount;
                position.status = PositionStatus::Refunded;
            }
            MarketStatus::Resolved => {
                let Some(outcome) = market.outcome else {
                    return err!(ExoduzeError::MarketNotResolved);
                };

                let (payout_amount, fee_amount) = if position.side == outcome {
                    calculate_winning_payout(
                        position.stake_amount,
                        market,
                        ctx.accounts.config.fee_bps,
                    )?
                } else {
                    (0, 0)
                };

                if fee_amount > 0 {
                    transfer_from_vault(
                        ctx.program_id,
                        &ctx.accounts.token_program,
                        &ctx.accounts.market,
                        &ctx.accounts.vault,
                        &ctx.accounts.treasury_token_account,
                        fee_amount,
                    )?;
                }

                if payout_amount > 0 {
                    transfer_from_vault(
                        ctx.program_id,
                        &ctx.accounts.token_program,
                        &ctx.accounts.market,
                        &ctx.accounts.vault,
                        &ctx.accounts.user_token_account,
                        payout_amount,
                    )?;
                }

                position.claimed_amount = payout_amount;
                position.status = PositionStatus::Claimed;
            }
            MarketStatus::Active => return err!(ExoduzeError::MarketNotResolved),
        }

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + Config::LEN,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateOracleAuthority<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin_authority @ ExoduzeError::Unauthorized
    )]
    pub config: Account<'info, Config>,
    pub admin_authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdateFeeBps<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin_authority @ ExoduzeError::Unauthorized
    )]
    pub config: Account<'info, Config>,
    pub admin_authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdateTreasuryAuthority<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin_authority @ ExoduzeError::Unauthorized
    )]
    pub config: Account<'info, Config>,
    pub admin_authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct TogglePause<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin_authority @ ExoduzeError::Unauthorized
    )]
    pub config: Account<'info, Config>,
    pub admin_authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(
    market_id_hash: [u8; 32],
    _opens_at: i64,
    _join_deadline_at: i64,
    _decision_cutoff_at: i64,
    _closes_at: i64,
    _resolves_at: i64
)]
pub struct CreateMarket<'info> {
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin_authority @ ExoduzeError::Unauthorized
    )]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = authority,
        space = 8 + Market::LEN,
        seeds = [MARKET_SEED, market_id_hash.as_ref()],
        bump
    )]
    pub market: Account<'info, Market>,
    pub settlement_mint: Account<'info, Mint>,
    #[account(
        mut,
        seeds = [VAULT_SEED, market.key().as_ref()],
        bump
    )]
    /// CHECK: The PDA is created and initialized as an SPL token account in the handler.
    pub vault: UncheckedAccount<'info>,
    #[account(
        mut,
        constraint = authority.key() == admin_authority.key() @ ExoduzeError::Unauthorized
    )]
    pub authority: Signer<'info>,
    /// CHECK: This key must match config.admin_authority via has_one above.
    pub admin_authority: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelMarket<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [MARKET_SEED, market.market_id_hash.as_ref()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct CommitAgentDecision<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        seeds = [MARKET_SEED, market.market_id_hash.as_ref()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,
    #[account(
        init_if_needed,
        payer = agent_authority,
        space = 8 + AgentCommitment::LEN,
        seeds = [AGENT_COMMITMENT_SEED, market.key().as_ref(), agent_authority.key().as_ref()],
        bump
    )]
    pub agent_commitment: Account<'info, AgentCommitment>,
    #[account(mut)]
    pub agent_authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct OpenPosition<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        mut,
        seeds = [MARKET_SEED, market.market_id_hash.as_ref()],
        bump = market.bump,
        constraint = market.settlement_mint == settlement_mint.key() @ ExoduzeError::InvalidMint,
        constraint = market.vault == vault.key() @ ExoduzeError::InvalidVault
    )]
    pub market: Box<Account<'info, Market>>,
    #[account(
        seeds = [AGENT_COMMITMENT_SEED, market.key().as_ref(), agent_commitment.agent_authority.as_ref()],
        bump = agent_commitment.bump
    )]
    pub agent_commitment: Box<Account<'info, AgentCommitment>>,
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + Position::LEN,
        seeds = [POSITION_SEED, market.key().as_ref(), user.key().as_ref(), agent_commitment.key().as_ref()],
        bump
    )]
    pub position: Box<Account<'info, Position>>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        constraint = user_token_account.owner == user.key() @ ExoduzeError::InvalidTokenAccount,
        constraint = user_token_account.mint == settlement_mint.key() @ ExoduzeError::InvalidTokenAccount
    )]
    pub user_token_account: Box<Account<'info, TokenAccount>>,
    pub settlement_mint: Box<Account<'info, Mint>>,
    #[account(
        mut,
        seeds = [VAULT_SEED, market.key().as_ref()],
        bump,
        constraint = vault.mint == settlement_mint.key() @ ExoduzeError::InvalidVault,
        constraint = vault.owner == vault.key() @ ExoduzeError::InvalidVault
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ResolveMarket<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [MARKET_SEED, market.market_id_hash.as_ref()],
        bump = market.bump,
        has_one = oracle_authority @ ExoduzeError::Unauthorized
    )]
    pub market: Account<'info, Market>,
    pub oracle_authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ClaimPayout<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        seeds = [MARKET_SEED, market.market_id_hash.as_ref()],
        bump = market.bump,
        constraint = market.settlement_mint == settlement_mint.key() @ ExoduzeError::InvalidMint,
        constraint = market.vault == vault.key() @ ExoduzeError::InvalidVault
    )]
    pub market: Box<Account<'info, Market>>,
    #[account(
        mut,
        seeds = [POSITION_SEED, market.key().as_ref(), user.key().as_ref(), position.agent_commitment.as_ref()],
        bump = position.bump
    )]
    pub position: Box<Account<'info, Position>>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        constraint = user_token_account.owner == user.key() @ ExoduzeError::InvalidTokenAccount,
        constraint = user_token_account.mint == settlement_mint.key() @ ExoduzeError::InvalidTokenAccount
    )]
    pub user_token_account: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = treasury_token_account.owner == config.treasury_authority @ ExoduzeError::InvalidTokenAccount,
        constraint = treasury_token_account.mint == settlement_mint.key() @ ExoduzeError::InvalidTokenAccount
    )]
    pub treasury_token_account: Box<Account<'info, TokenAccount>>,
    pub settlement_mint: Box<Account<'info, Mint>>,
    #[account(
        mut,
        seeds = [VAULT_SEED, market.key().as_ref()],
        bump,
        constraint = vault.mint == settlement_mint.key() @ ExoduzeError::InvalidVault,
        constraint = vault.owner == vault.key() @ ExoduzeError::InvalidVault
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct Config {
    pub admin_authority: Pubkey,
    pub oracle_authority: Pubkey,
    pub treasury_authority: Pubkey,
    pub fee_bps: u16,
    pub paused: bool,
    pub bump: u8,
}

impl Config {
    pub const LEN: usize = 32 + 32 + 32 + 2 + 1 + 1;
}

#[account]
pub struct Market {
    pub market_id_hash: [u8; 32],
    pub authority: Pubkey,
    pub oracle_authority: Pubkey,
    pub settlement_mint: Pubkey,
    pub vault: Pubkey,
    pub opens_at: i64,
    pub join_deadline_at: i64,
    pub decision_cutoff_at: i64,
    pub closes_at: i64,
    pub resolves_at: i64,
    pub status: MarketStatus,
    pub outcome: Option<Side>,
    pub total_yes_stake: u64,
    pub total_no_stake: u64,
    pub total_stake: u64,
    pub bump: u8,
}

impl Market {
    pub const LEN: usize = 32 + 32 + 32 + 32 + 32 + 8 + 8 + 8 + 8 + 8 + 1 + 2 + 8 + 8 + 8 + 1;
}

#[account]
pub struct AgentCommitment {
    pub market: Pubkey,
    pub agent_authority: Pubkey,
    pub agent_id_hash: [u8; 32],
    pub snapshot_hash: [u8; 32],
    pub prompt_hash: [u8; 32],
    pub config_hash: [u8; 32],
    pub reason_hash: [u8; 32],
    pub decision_side: Side,
    pub committed_at: i64,
    pub bump: u8,
}

impl AgentCommitment {
    pub const LEN: usize = 32 + 32 + 32 + 32 + 32 + 32 + 32 + 1 + 8 + 1;
}

#[account]
pub struct Position {
    pub market: Pubkey,
    pub user: Pubkey,
    pub agent_commitment: Pubkey,
    pub side: Side,
    pub stake_amount: u64,
    pub claimed_amount: u64,
    pub status: PositionStatus,
    pub bump: u8,
}

impl Position {
    pub const LEN: usize = 32 + 32 + 32 + 1 + 8 + 8 + 1 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    Yes,
    No,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum MarketStatus {
    Active,
    Cancelled,
    Resolved,
    Invalid,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum PositionStatus {
    Open,
    Claimed,
    Refunded,
}

#[error_code]
pub enum ExoduzeError {
    #[msg("Caller is not authorized for this instruction")]
    Unauthorized,
    #[msg("Program is paused")]
    ProgramPaused,
    #[msg("Fee basis points cannot exceed 10000")]
    FeeTooHigh,
    #[msg("Market schedule is invalid")]
    InvalidMarketSchedule,
    #[msg("Market is not active")]
    MarketNotActive,
    #[msg("Market has not opened yet")]
    MarketNotOpen,
    #[msg("Market deadline has passed")]
    MarketDeadlinePassed,
    #[msg("Market is already closed")]
    MarketAlreadyClosed,
    #[msg("Market is not closed yet")]
    MarketNotClosed,
    #[msg("Market has not been resolved")]
    MarketNotResolved,
    #[msg("No stake exists on the winning side")]
    NoWinningStake,
    #[msg("Stake amount must be greater than zero")]
    InvalidStakeAmount,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Agent commitment does not match the market")]
    InvalidAgentCommitment,
    #[msg("Position does not match expected accounts")]
    InvalidPosition,
    #[msg("Position is already claimed or refunded")]
    PositionAlreadyClaimed,
    #[msg("Token account is not valid for this market")]
    InvalidTokenAccount,
    #[msg("Settlement mint does not match the market")]
    InvalidMint,
    #[msg("Vault does not match the market")]
    InvalidVault,
}

fn validate_fee_bps(fee_bps: u16) -> Result<()> {
    require!(fee_bps <= MAX_FEE_BPS, ExoduzeError::FeeTooHigh);
    Ok(())
}

fn require_not_paused(config: &Config) -> Result<()> {
    require!(!config.paused, ExoduzeError::ProgramPaused);
    Ok(())
}

fn validate_market_schedule(
    opens_at: i64,
    join_deadline_at: i64,
    decision_cutoff_at: i64,
    closes_at: i64,
    resolves_at: i64,
) -> Result<()> {
    require!(
        opens_at <= join_deadline_at
            && join_deadline_at <= decision_cutoff_at
            && decision_cutoff_at <= closes_at
            && (resolves_at == 0 || resolves_at >= closes_at),
        ExoduzeError::InvalidMarketSchedule
    );
    Ok(())
}

fn resolve_not_before(market: &Market) -> i64 {
    if market.resolves_at > 0 {
        market.resolves_at
    } else {
        market.closes_at
    }
}

fn upsert_agent_commitment(
    commitment: &mut AgentCommitment,
    market: Pubkey,
    agent_authority: Pubkey,
    agent_id_hash: [u8; 32],
    snapshot_hash: [u8; 32],
    prompt_hash: [u8; 32],
    config_hash: [u8; 32],
    reason_hash: [u8; 32],
    decision_side: Side,
    committed_at: i64,
    bump: u8,
) -> Result<()> {
    let is_new = commitment.market == Pubkey::default();

    if is_new {
        commitment.market = market;
        commitment.agent_authority = agent_authority;
        commitment.agent_id_hash = agent_id_hash;
        commitment.snapshot_hash = snapshot_hash;
        commitment.prompt_hash = prompt_hash;
        commitment.config_hash = config_hash;
        commitment.reason_hash = reason_hash;
        commitment.decision_side = decision_side;
        commitment.committed_at = committed_at;
        commitment.bump = bump;
        return Ok(());
    }

    require!(
        commitment.market == market
            && commitment.agent_authority == agent_authority
            && commitment.agent_id_hash == agent_id_hash
            && commitment.snapshot_hash == snapshot_hash
            && commitment.prompt_hash == prompt_hash
            && commitment.config_hash == config_hash
            && commitment.reason_hash == reason_hash
            && commitment.decision_side == decision_side,
        ExoduzeError::InvalidAgentCommitment
    );

    Ok(())
}

fn calculate_winning_payout(
    stake_amount: u64,
    market: &Market,
    fee_bps: u16,
) -> Result<(u64, u64)> {
    let winning_total = match market.outcome {
        Some(Side::Yes) => market.total_yes_stake,
        Some(Side::No) => market.total_no_stake,
        None => return err!(ExoduzeError::MarketNotResolved),
    };

    require!(winning_total > 0, ExoduzeError::NoWinningStake);

    let losing_total = market
        .total_stake
        .checked_sub(winning_total)
        .ok_or(ExoduzeError::MathOverflow)?;

    let stake_amount_u128 = stake_amount as u128;
    let gross_u128 = stake_amount_u128
        .checked_add(
            (stake_amount_u128)
                .checked_mul(losing_total as u128)
                .ok_or(ExoduzeError::MathOverflow)?
                .checked_div(winning_total as u128)
                .ok_or(ExoduzeError::MathOverflow)?,
        )
        .ok_or(ExoduzeError::MathOverflow)?;

    let fee_u128 = gross_u128
        .checked_mul(fee_bps as u128)
        .ok_or(ExoduzeError::MathOverflow)?
        .checked_div(MAX_FEE_BPS as u128)
        .ok_or(ExoduzeError::MathOverflow)?;

    let payout_u128 = gross_u128
        .checked_sub(fee_u128)
        .ok_or(ExoduzeError::MathOverflow)?;

    let payout_amount =
        u64::try_from(payout_u128).map_err(|_| error!(ExoduzeError::MathOverflow))?;
    let fee_amount = u64::try_from(fee_u128).map_err(|_| error!(ExoduzeError::MathOverflow))?;

    Ok((payout_amount, fee_amount))
}

fn create_vault_token_account<'info>(
    payer: &AccountInfo<'info>,
    vault: &AccountInfo<'info>,
    settlement_mint: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    market_key: Pubkey,
    vault_bump: u8,
) -> Result<()> {
    let rent = Rent::get()?;
    let vault_size = spl_token::state::Account::LEN;
    let bump_seed = [vault_bump];
    let market_key_bytes = market_key.to_bytes();
    let signer_seeds: &[&[u8]] = &[VAULT_SEED, &market_key_bytes, &bump_seed];

    invoke_signed(
        &system_instruction::create_account(
            payer.key,
            vault.key,
            rent.minimum_balance(vault_size),
            vault_size as u64,
            token_program.key,
        ),
        &[payer.clone(), vault.clone(), system_program.clone()],
        &[signer_seeds],
    )?;

    invoke(
        &spl_token::instruction::initialize_account3(
            token_program.key,
            vault.key,
            settlement_mint.key,
            vault.key,
        )?,
        &[
            vault.clone(),
            settlement_mint.clone(),
            token_program.clone(),
        ],
    )?;

    Ok(())
}

fn transfer_from_user_to_vault<'info>(
    token_program: &Program<'info, Token>,
    from: &Account<'info, TokenAccount>,
    vault: &Account<'info, TokenAccount>,
    authority: &Signer<'info>,
    amount: u64,
) -> Result<()> {
    token::transfer(
        CpiContext::new(
            token_program.to_account_info(),
            Transfer {
                from: from.to_account_info(),
                to: vault.to_account_info(),
                authority: authority.to_account_info(),
            },
        ),
        amount,
    )
}

fn transfer_from_vault<'info>(
    program_id: &Pubkey,
    token_program: &Program<'info, Token>,
    market: &Account<'info, Market>,
    vault: &Account<'info, TokenAccount>,
    destination: &Account<'info, TokenAccount>,
    amount: u64,
) -> Result<()> {
    let (expected_vault, vault_bump) =
        Pubkey::find_program_address(&[VAULT_SEED, market.key().as_ref()], program_id);
    require_keys_eq!(expected_vault, vault.key(), ExoduzeError::InvalidVault);

    let bump_seed = [vault_bump];
    let market_key = market.key();
    let signer_seeds: &[&[u8]] = &[VAULT_SEED, market_key.as_ref(), &bump_seed];

    token::transfer(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            Transfer {
                from: vault.to_account_info(),
                to: destination.to_account_info(),
                authority: vault.to_account_info(),
            },
            &[signer_seeds],
        ),
        amount,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn winning_payout_applies_pool_share_and_fee() {
        let market = Market {
            market_id_hash: [0; 32],
            authority: Pubkey::default(),
            oracle_authority: Pubkey::default(),
            settlement_mint: Pubkey::default(),
            vault: Pubkey::default(),
            opens_at: 0,
            join_deadline_at: 0,
            decision_cutoff_at: 0,
            closes_at: 0,
            resolves_at: 0,
            status: MarketStatus::Resolved,
            outcome: Some(Side::Yes),
            total_yes_stake: 400,
            total_no_stake: 600,
            total_stake: 1_000,
            bump: 0,
        };

        let (payout, fee) = calculate_winning_payout(100, &market, 100).unwrap();

        assert_eq!(payout, 248);
        assert_eq!(fee, 2);
    }

    #[test]
    fn schedule_validation_rejects_invalid_order() {
        let result = validate_market_schedule(20, 10, 30, 40, 50);
        assert!(result.is_err());
    }

    #[test]
    fn recommit_is_idempotent_for_same_payload() {
        let market = Pubkey::new_unique();
        let authority = Pubkey::new_unique();
        let mut commitment = AgentCommitment {
            market: Pubkey::default(),
            agent_authority: Pubkey::default(),
            agent_id_hash: [0; 32],
            snapshot_hash: [0; 32],
            prompt_hash: [0; 32],
            config_hash: [0; 32],
            reason_hash: [0; 32],
            decision_side: Side::Yes,
            committed_at: 0,
            bump: 0,
        };

        upsert_agent_commitment(
            &mut commitment,
            market,
            authority,
            [1; 32],
            [2; 32],
            [3; 32],
            [4; 32],
            [5; 32],
            Side::Yes,
            100,
            7,
        )
        .unwrap();

        upsert_agent_commitment(
            &mut commitment,
            market,
            authority,
            [1; 32],
            [2; 32],
            [3; 32],
            [4; 32],
            [5; 32],
            Side::Yes,
            200,
            7,
        )
        .unwrap();

        assert_eq!(commitment.committed_at, 100);
        assert_eq!(commitment.bump, 7);
    }

    #[test]
    fn recommit_rejects_changed_payload() {
        let market = Pubkey::new_unique();
        let authority = Pubkey::new_unique();
        let mut commitment = AgentCommitment {
            market: Pubkey::default(),
            agent_authority: Pubkey::default(),
            agent_id_hash: [0; 32],
            snapshot_hash: [0; 32],
            prompt_hash: [0; 32],
            config_hash: [0; 32],
            reason_hash: [0; 32],
            decision_side: Side::Yes,
            committed_at: 0,
            bump: 0,
        };

        upsert_agent_commitment(
            &mut commitment,
            market,
            authority,
            [1; 32],
            [2; 32],
            [3; 32],
            [4; 32],
            [5; 32],
            Side::Yes,
            100,
            7,
        )
        .unwrap();

        let result = upsert_agent_commitment(
            &mut commitment,
            market,
            authority,
            [1; 32],
            [9; 32],
            [3; 32],
            [4; 32],
            [5; 32],
            Side::No,
            200,
            7,
        );

        assert!(result.is_err());
    }
}
