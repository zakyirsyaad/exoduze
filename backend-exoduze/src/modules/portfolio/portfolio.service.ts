import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";

import type { Env } from "../../config/env.js";
import type { AppDatabase } from "../../db/database.js";
import { queryOne, queryRows } from "../../db/query.js";
import { HttpError } from "../../lib/http-error.js";
import { writeAuditLog } from "../audit/audit-log.js";
import {
  buildHybridPayoutBreakdownByPositionKey,
  formatSettlementDecimalUnits,
  getTopRankedWinningMarketAgentIds,
} from "../markets/markets.service.js";
import type { ExoduzeOnchainService } from "../onchain/exoduze-onchain.service.js";
import { effectiveMarketStatusSql } from "../markets/market-status.js";

type WalletIdentityRow = {
  id: string;
  wallet_address: string;
};

type UserParticipantRow = {
  position_id: string;
  stake_usdc: string;
  position_units: string | null;
  onchain_position_ref: string | null;
  open_tx_sig: string | null;
  status: string;
  opened_at: string;
  market_id: string;
  market_slug: string;
  market_title: string;
  market_status: string;
  market_onchain_pubkey: string | null;
  agent_id: string;
  agent_slug: string;
  agent_name: string;
  market_agent_id: string;
  final_decision_side: string | null;
  payout_id: string | null;
  payout_status: string | null;
  net_usdc: string | null;
};

type AiBattleRow = {
  market_agent_id: string;
  joined_at: string;
  status: string;
  final_decision_side: string | null;
  final_decision_at: string | null;
  agent_id: string;
  agent_slug: string;
  agent_name: string;
  market_id: string;
  market_slug: string;
  market_title: string;
  market_status: string;
  follower_staked_usdc: string;
  follower_count: number;
};

type PortfolioPayoutRow = {
  payout_id: string;
  gross_usdc: string;
  fee_usdc: string;
  net_usdc: string;
  payout_tx_sig: string | null;
  status: string;
  paid_at: string | null;
  market_id: string;
  market_slug: string;
  market_title: string;
  market_onchain_pubkey: string | null;
  market_agent_id: string;
  agent_id: string;
  agent_slug: string;
  agent_name: string;
  onchain_position_ref: string | null;
};

type PayoutClaimRow = {
  id: string;
  gross_usdc: string;
  fee_usdc: string;
  net_usdc: string;
  status: string;
  market_id: string;
  market_onchain_pubkey: string | null;
  onchain_position_ref: string | null;
};

type RecordClaimInput = {
  txSig: string;
};

type ServiceLogger = {
  error?: (input: unknown, message?: string) => void;
};

export class PortfolioService {
  private readonly connection: Connection;

  constructor(
    private readonly db: AppDatabase,
    private readonly env: Env,
    private readonly onchainService?: ExoduzeOnchainService,
    private readonly logger?: ServiceLogger,
  ) {
    this.connection = new Connection(env.SOLANA_RPC_URL, "confirmed");
  }

  async getPortfolio(walletAddress: string) {
    const wallet = await this.requireWalletIdentity(walletAddress);
    const [balances, userParticipants, aiBattles, payouts] = await Promise.all([
      this.getWalletBalances(wallet.wallet_address),
      this.listUserParticipants(wallet.id),
      this.listAiBattles(wallet.id),
      this.listPayouts(wallet.id),
    ]);
    const topBonusEligibleMarketAgentIds =
      await this.getTopBonusEligibleMarketAgentIds([
        ...userParticipants.map((item) => item.market.id),
        ...aiBattles.map((item) => item.market.id),
        ...payouts.map((item) => item.market.id),
      ]);
    const payoutBreakdownByPositionKey = await this.getPayoutBreakdownByPositionKey(
      wallet.id,
      [
        ...userParticipants.map((item) => item.market.id),
        ...payouts.map((item) => item.market.id),
      ],
    );

    return {
      data: {
        wallet: {
          wallet_identity_id: wallet.id,
          wallet_address: wallet.wallet_address,
        },
        balances,
        user_participants: userParticipants.map((item) => ({
          ...item,
          agent: {
            ...item.agent,
            top_bonus_eligible: topBonusEligibleMarketAgentIds.has(
              item.agent.market_agent_id,
            ),
          },
          payout: item.payout
            ? {
                ...item.payout,
                top_bonus_eligible: topBonusEligibleMarketAgentIds.has(
                  item.agent.market_agent_id,
                ),
                breakdown: payoutBreakdownByPositionKey.get(
                  `${wallet.id}:${item.agent.market_agent_id}`,
                ),
              }
            : null,
        })),
        ai_battles: aiBattles.map((item) => ({
          ...item,
          top_bonus_eligible: topBonusEligibleMarketAgentIds.has(
            item.market_agent_id,
          ),
        })),
        payouts: payouts.map((item) => ({
          ...item,
          top_bonus_eligible: topBonusEligibleMarketAgentIds.has(
            item.agent.market_agent_id,
          ),
          breakdown: payoutBreakdownByPositionKey.get(
            `${wallet.id}:${item.agent.market_agent_id}`,
          ),
        })),
      },
    };
  }

  async recordPayoutClaim(
    walletAddress: string,
    payoutId: string,
    input: RecordClaimInput,
  ) {
    const wallet = await this.requireWalletIdentity(walletAddress);
    const payout = await queryOne<PayoutClaimRow>(
      this.db,
      `
        SELECT
          p.id,
          p.gross_usdc::text,
          p.fee_usdc::text,
          p.net_usdc::text,
          p.status,
          p.market_id,
          m.onchain_market_pubkey AS market_onchain_pubkey,
          up.onchain_position_ref
        FROM payouts p
        JOIN markets m ON m.id = p.market_id
        LEFT JOIN LATERAL (
          SELECT onchain_position_ref
          FROM user_positions up
          WHERE up.market_id = p.market_id
            AND up.market_agent_id = p.market_agent_id
            AND up.wallet_identity_id = p.wallet_identity_id
          ORDER BY up.created_at DESC
          LIMIT 1
        ) up ON true
        WHERE p.id = $1 AND p.wallet_identity_id = $2
        LIMIT 1
      `,
      [payoutId, wallet.id],
    );

    if (!payout) {
      throw new HttpError(
        404,
        "PAYOUT_NOT_FOUND",
        `Payout '${payoutId}' was not found for this wallet.`,
      );
    }

    const signatureStatus = this.onchainService
      ? await this.onchainService.getSignatureStatus(input.txSig)
      : null;
    if (signatureStatus?.failed) {
      await this.auditClaimVerification("failed", wallet.id, payout.id, {
        market_id: payout.market_id,
        reason: "ONCHAIN_TX_FAILED",
      });
      throw new HttpError(409, "ONCHAIN_TX_FAILED", "The payout claim transaction failed.");
    }

    let status: "paid" | "submitted";
    if (signatureStatus?.confirmed) {
      try {
        status = await this.requireConfirmedOnchainPayoutClaim(
          wallet.wallet_address,
          payout,
          input.txSig,
        );
      } catch (error) {
        await this.auditClaimVerification("failed", wallet.id, payout.id, {
          market_id: payout.market_id,
          reason: error instanceof HttpError ? error.code : "CLAIM_VERIFICATION_FAILED",
        });
        throw error;
      }
    } else {
      status = "submitted";
    }

    const paidAt = status === "paid" ? new Date().toISOString() : null;

    await this.db.query(
      `
        UPDATE payouts
        SET
          payout_tx_sig = CASE WHEN status = 'paid' THEN payout_tx_sig ELSE $3 END,
          status = CASE WHEN status = 'paid' THEN status ELSE $4 END,
          paid_at = CASE
            WHEN status = 'paid' THEN paid_at
            WHEN $5::timestamptz IS NULL THEN paid_at
            ELSE $5::timestamptz
          END,
          updated_at = now()
        WHERE id = $1 AND wallet_identity_id = $2
      `,
      [payout.id, wallet.id, input.txSig, status, paidAt],
    );
    if (status === "paid") {
      await this.auditClaimVerification("succeeded", wallet.id, payout.id, {
        market_id: payout.market_id,
        status,
      });
    }

    return this.getPortfolio(wallet.wallet_address);
  }

  private async auditClaimVerification(
    result: "succeeded" | "failed",
    walletIdentityId: string,
    payoutId: string,
    after: Record<string, unknown>,
  ) {
    await writeAuditLog(this.db, this.logger, {
      action: `claim_verification.${result}`,
      actorType: "wallet",
      actorWalletIdentityId: walletIdentityId,
      entityType: "payout",
      entityId: payoutId,
      after,
    });
  }

  private async requireConfirmedOnchainPayoutClaim(
    walletAddress: string,
    payout: PayoutClaimRow,
    txSig: string,
  ): Promise<"paid"> {
    if (!payout.market_onchain_pubkey || !payout.onchain_position_ref) {
      throw new HttpError(
        409,
        "PAYOUT_ONCHAIN_REFERENCE_MISSING",
        "This payout is missing the on-chain market or position reference.",
      );
    }

    if (!this.onchainService) {
      throw new HttpError(
        503,
        "ONCHAIN_CLIENT_NOT_CONFIGURED",
        "On-chain claim verification is not configured.",
      );
    }

    const transaction = await this.onchainService.getTransactionSummary(txSig);
    if (!transaction) {
      throw new HttpError(
        409,
        "ONCHAIN_TX_NOT_FOUND",
        "The payout claim transaction could not be fetched or failed on-chain.",
      );
    }

    if (!transaction.program_ids.includes(this.env.EXODUZE_PROGRAM_ID)) {
      throw new HttpError(
        409,
        "ONCHAIN_TX_PROGRAM_MISMATCH",
        "The payout claim transaction was not executed by the configured Exoduze program.",
      );
    }

    if (!transaction.account_keys.includes(payout.market_onchain_pubkey)) {
      throw new HttpError(
        409,
        "ONCHAIN_TX_MARKET_MISMATCH",
        "The payout claim transaction does not reference the expected market account.",
      );
    }

    if (!transaction.account_keys.includes(payout.onchain_position_ref)) {
      throw new HttpError(
        409,
        "ONCHAIN_TX_POSITION_MISMATCH",
        "The payout claim transaction does not reference the expected user position account.",
      );
    }

    if (
      !transaction.account_keys.includes(walletAddress) ||
      !transaction.signer_keys.includes(walletAddress)
    ) {
      throw new HttpError(
        403,
        "ONCHAIN_TX_WALLET_MISMATCH",
        "The payout claim transaction was not signed by the expected payout wallet.",
      );
    }

    const position = await this.onchainService.getPosition(payout.onchain_position_ref);
    if (!position) {
      throw new HttpError(
        409,
        "ONCHAIN_POSITION_NOT_FOUND",
        "The expected on-chain position was not found.",
      );
    }

    if (position.market !== payout.market_onchain_pubkey) {
      throw new HttpError(
        409,
        "ONCHAIN_POSITION_MARKET_MISMATCH",
        "The on-chain position belongs to a different market.",
      );
    }

    if (position.user !== walletAddress) {
      throw new HttpError(
        403,
        "ONCHAIN_POSITION_OWNER_MISMATCH",
        "The on-chain position belongs to a different wallet.",
      );
    }

    if (position.status !== "CLAIMED") {
      throw new HttpError(
        409,
        "ONCHAIN_PAYOUT_NOT_CLAIMED",
        "The on-chain position has not been claimed yet.",
      );
    }

    const expectedPayoutBaseUnits = this.parseUsdcBaseUnits(payout.net_usdc);
    const claimedAmountBaseUnits = BigInt(position.claimed_amount_base_units);
    if (claimedAmountBaseUnits <= 0n) {
      throw new HttpError(
        409,
        "ONCHAIN_CLAIM_EMPTY",
        "The on-chain claim did not transfer a positive payout.",
      );
    }

    if (claimedAmountBaseUnits !== expectedPayoutBaseUnits) {
      throw new HttpError(
        409,
        "ONCHAIN_CLAIM_AMOUNT_MISMATCH",
        "The on-chain claim amount does not match the expected backend payout.",
      );
    }

    return "paid";
  }

  private parseUsdcBaseUnits(value: string) {
    const normalized = value.trim();
    const match = /^(\d+)(?:\.(\d+))?$/.exec(normalized);
    if (!match) {
      throw new HttpError(
        409,
        "PAYOUT_AMOUNT_INVALID",
        "The expected payout amount is not a valid USDC decimal.",
      );
    }

    const fractionalPart = match[2] ?? "";
    const wholePart = match[1] ?? "0";
    const baseFraction = fractionalPart.slice(0, 6);
    const extraFraction = fractionalPart.slice(6);
    if (/[1-9]/.test(extraFraction)) {
      throw new HttpError(
        409,
        "PAYOUT_AMOUNT_PRECISION_UNSUPPORTED",
        "The expected payout amount has more precision than the settlement mint supports.",
      );
    }

    return (
      BigInt(wholePart) * 1_000_000n +
      BigInt(baseFraction.padEnd(6, "0") || "0")
    );
  }

  private async requireWalletIdentity(walletAddress: string) {
    const wallet = await queryOne<WalletIdentityRow>(
      this.db,
      `
        SELECT id, wallet_address
        FROM wallet_identities
        WHERE wallet_address = $1 AND is_active = true
        LIMIT 1
      `,
      [walletAddress],
    );

    if (!wallet) {
      throw new HttpError(
        404,
        "WALLET_NOT_FOUND",
        `Wallet '${walletAddress}' was not found.`,
      );
    }

    return wallet;
  }

  private async getWalletBalances(walletAddress: string) {
    const publicKey = new PublicKey(walletAddress);
    const solLamports = await this.connection.getBalance(publicKey, "confirmed");
    const usdcBalance = this.env.EXODUZE_SETTLEMENT_MINT
      ? await this.getTokenBalance(publicKey, new PublicKey(this.env.EXODUZE_SETTLEMENT_MINT))
      : {
          amount_base_units: "0",
          decimals: 0,
          ui_amount_string: "0",
          mint: null,
        };

    return {
      sol: {
        lamports: solLamports.toString(),
        ui_amount_string: (solLamports / LAMPORTS_PER_SOL).toString(),
      },
      usdc: usdcBalance,
    };
  }

  private async getTokenBalance(owner: PublicKey, mint: PublicKey) {
    const accounts = await this.connection.getParsedTokenAccountsByOwner(owner, {
      mint,
    });
    let totalBaseUnits = 0n;
    let decimals = 0;

    for (const account of accounts.value) {
      const tokenAmount = account.account.data.parsed.info.tokenAmount;
      totalBaseUnits += BigInt(tokenAmount.amount);
      decimals = tokenAmount.decimals;
    }

    return {
      amount_base_units: totalBaseUnits.toString(),
      decimals,
      ui_amount_string: this.formatTokenUnits(totalBaseUnits, decimals),
      mint: mint.toBase58(),
    };
  }

  private async listUserParticipants(walletIdentityId: string) {
    const rows = await queryRows<UserParticipantRow>(
      this.db,
      `
        SELECT
          up.id AS position_id,
          up.stake_usdc::text,
          up.position_units::text,
          up.onchain_position_ref,
          up.open_tx_sig,
          up.status,
          up.created_at::text AS opened_at,
          m.id AS market_id,
          m.slug AS market_slug,
          m.title AS market_title,
          (${effectiveMarketStatusSql("m")}) AS market_status,
          m.onchain_market_pubkey AS market_onchain_pubkey,
          a.id AS agent_id,
          a.slug AS agent_slug,
          a.name AS agent_name,
          ma.id AS market_agent_id,
          ma.final_decision_side,
          payout.id AS payout_id,
          payout.status AS payout_status,
          payout.net_usdc::text
        FROM user_positions up
        JOIN markets m ON m.id = up.market_id
        JOIN market_agents ma ON ma.id = up.market_agent_id
        JOIN agents a ON a.id = ma.agent_id
        LEFT JOIN LATERAL (
          SELECT id, status, net_usdc
          FROM payouts p
          WHERE p.market_id = up.market_id
            AND p.market_agent_id = up.market_agent_id
            AND p.wallet_identity_id = up.wallet_identity_id
          ORDER BY p.created_at DESC
          LIMIT 1
        ) payout ON true
        WHERE up.wallet_identity_id = $1
        ORDER BY up.created_at DESC
      `,
      [walletIdentityId],
    );

    return rows.map((row) => ({
      participant_type: "user_participant",
      position: {
        id: row.position_id,
        stake_usdc: row.stake_usdc,
        position_units: row.position_units,
        onchain_position_ref: row.onchain_position_ref,
        open_tx_sig: row.open_tx_sig,
        status: row.status,
        opened_at: row.opened_at,
      },
      market: {
        id: row.market_id,
        slug: row.market_slug,
        title: row.market_title,
        status: row.market_status,
        onchain_market_pubkey: row.market_onchain_pubkey,
      },
      agent: {
        id: row.agent_id,
        slug: row.agent_slug,
        name: row.agent_name,
        market_agent_id: row.market_agent_id,
        final_decision_side: row.final_decision_side,
      },
      payout: row.payout_id
        ? {
            id: row.payout_id,
            status: row.payout_status,
            net_usdc: row.net_usdc,
          }
        : null,
    }));
  }

  private async listAiBattles(walletIdentityId: string) {
    const rows = await queryRows<AiBattleRow>(
      this.db,
      `
        SELECT
          ma.id AS market_agent_id,
          ma.joined_at::text,
          ma.status,
          ma.final_decision_side,
          ma.final_decision_at::text,
          a.id AS agent_id,
          a.slug AS agent_slug,
          a.name AS agent_name,
          m.id AS market_id,
          m.slug AS market_slug,
          m.title AS market_title,
          (${effectiveMarketStatusSql("m")}) AS market_status,
          COALESCE(SUM(up.stake_usdc), 0)::text AS follower_staked_usdc,
          COUNT(up.id)::integer AS follower_count
        FROM market_agents ma
        JOIN agents a ON a.id = ma.agent_id
        JOIN markets m ON m.id = ma.market_id
        LEFT JOIN user_positions up ON up.market_agent_id = ma.id
        WHERE a.owner_wallet_identity_id = $1
        GROUP BY ma.id, a.id, m.id
        ORDER BY ma.joined_at DESC
      `,
      [walletIdentityId],
    );

    return rows.map((row) => ({
      participant_type: "ai_join_battle",
      market_agent_id: row.market_agent_id,
      joined_at: row.joined_at,
      status: row.status,
      final_decision_side: row.final_decision_side,
      final_decision_at: row.final_decision_at,
      follower_staked_usdc: row.follower_staked_usdc,
      follower_count: Number(row.follower_count),
      agent: {
        id: row.agent_id,
        slug: row.agent_slug,
        name: row.agent_name,
      },
      market: {
        id: row.market_id,
        slug: row.market_slug,
        title: row.market_title,
        status: row.market_status,
      },
    }));
  }

  private async listPayouts(walletIdentityId: string) {
    const rows = await queryRows<PortfolioPayoutRow>(
      this.db,
      `
        SELECT
          p.id AS payout_id,
          p.gross_usdc::text,
          p.fee_usdc::text,
          p.net_usdc::text,
          p.payout_tx_sig,
          p.status,
          p.paid_at::text,
          m.id AS market_id,
          m.slug AS market_slug,
          m.title AS market_title,
          m.onchain_market_pubkey AS market_onchain_pubkey,
          ma.id AS market_agent_id,
          a.id AS agent_id,
          a.slug AS agent_slug,
          a.name AS agent_name,
          up.onchain_position_ref
        FROM payouts p
        JOIN markets m ON m.id = p.market_id
        JOIN market_agents ma ON ma.id = p.market_agent_id
        JOIN agents a ON a.id = ma.agent_id
        LEFT JOIN LATERAL (
          SELECT onchain_position_ref
          FROM user_positions up
          WHERE up.market_id = p.market_id
            AND up.market_agent_id = p.market_agent_id
            AND up.wallet_identity_id = p.wallet_identity_id
          ORDER BY up.created_at DESC
          LIMIT 1
        ) up ON true
        WHERE p.wallet_identity_id = $1
        ORDER BY p.created_at DESC
      `,
      [walletIdentityId],
    );

    return rows.map((row) => ({
      id: row.payout_id,
      gross_usdc: row.gross_usdc,
      fee_usdc: row.fee_usdc,
      net_usdc: row.net_usdc,
      payout_tx_sig: row.payout_tx_sig,
      status: row.status,
      paid_at: row.paid_at,
      onchain_position_ref: row.onchain_position_ref,
      market: {
        id: row.market_id,
        slug: row.market_slug,
        title: row.market_title,
        onchain_market_pubkey: row.market_onchain_pubkey,
      },
      agent: {
        id: row.agent_id,
        slug: row.agent_slug,
        name: row.agent_name,
        market_agent_id: row.market_agent_id,
      },
    }));
  }

  private async getTopBonusEligibleMarketAgentIds(marketIds: string[]) {
    if (this.env.PAYOUT_TOP_AGENT_BONUS_BPS <= 0) {
      return new Set<string>();
    }

    const uniqueMarketIds = [...new Set(marketIds.filter(Boolean))];
    if (uniqueMarketIds.length === 0) {
      return new Set<string>();
    }

    const marketOutcomeRows = await queryRows<{
      market_id: string;
      final_outcome: string | null;
    }>(
      this.db,
      `
        SELECT
          m.id AS market_id,
          COALESCE(confirmed_result.outcome, m.final_outcome) AS final_outcome
        FROM markets m
        LEFT JOIN LATERAL (
          SELECT outcome
          FROM oracle_results
          WHERE market_id = m.id AND status = 'confirmed'
          ORDER BY resolved_at DESC NULLS LAST, created_at DESC
          LIMIT 1
        ) confirmed_result ON true
        WHERE m.id = ANY($1::text[])
      `,
      [uniqueMarketIds],
    );
    const agentRows = await queryRows<{
      market_id: string;
      market_agent_id: string;
      final_decision_side: string | null;
      decision_confidence: number | null;
    }>(
      this.db,
      `
        SELECT
          ma.market_id,
          ma.id AS market_agent_id,
          ma.final_decision_side,
          COALESCE(final_decision.confidence, latest_decision.confidence) AS decision_confidence
        FROM market_agents ma
        LEFT JOIN agent_market_decisions final_decision
          ON final_decision.id = ma.finalized_from_decision_id
        LEFT JOIN LATERAL (
          SELECT d.confidence
          FROM agent_market_decisions d
          WHERE d.market_agent_id = ma.id
          ORDER BY d.sequence_no DESC, d.decided_at DESC
          LIMIT 1
        ) latest_decision ON final_decision.id IS NULL
        WHERE ma.market_id = ANY($1::text[])
      `,
      [uniqueMarketIds],
    );

    const agentRowsByMarketId = new Map<
      string,
      Array<{
        market_agent_id: string;
        final_decision_side: string | null;
        decision_confidence: number | null;
      }>
    >();
    for (const row of agentRows) {
      const entries = agentRowsByMarketId.get(row.market_id) ?? [];
      entries.push({
        market_agent_id: row.market_agent_id,
        final_decision_side: row.final_decision_side,
        decision_confidence: row.decision_confidence,
      });
      agentRowsByMarketId.set(row.market_id, entries);
    }

    const eligibleMarketAgentIds = new Set<string>();
    for (const row of marketOutcomeRows) {
      if (!isMarketOutcome(row.final_outcome)) {
        continue;
      }

      const marketAgentIds = getTopRankedWinningMarketAgentIds(
        agentRowsByMarketId.get(row.market_id) ?? [],
        row.final_outcome,
      );
      for (const marketAgentId of marketAgentIds) {
        eligibleMarketAgentIds.add(marketAgentId);
      }
    }

    return eligibleMarketAgentIds;
  }

  private async getPayoutBreakdownByPositionKey(
    walletIdentityId: string,
    marketIds: string[],
  ) {
    const uniqueMarketIds = [...new Set(marketIds.filter(Boolean))];
    if (uniqueMarketIds.length === 0) {
      return new Map<
        string,
        {
          stake_return_usdc: string;
          base_pool_winnings_usdc: string;
          top_agent_bonus_usdc: string;
          gross_usdc: string;
          fee_usdc: string;
          net_usdc: string;
        }
      >();
    }

    const marketOutcomeRows = await queryRows<{
      market_id: string;
      final_outcome: string | null;
    }>(
      this.db,
      `
        SELECT
          m.id AS market_id,
          COALESCE(confirmed_result.outcome, m.final_outcome) AS final_outcome
        FROM markets m
        LEFT JOIN LATERAL (
          SELECT outcome
          FROM oracle_results
          WHERE market_id = m.id AND status = 'confirmed'
          ORDER BY resolved_at DESC NULLS LAST, created_at DESC
          LIMIT 1
        ) confirmed_result ON true
        WHERE m.id = ANY($1::text[])
      `,
      [uniqueMarketIds],
    );
    const positionRows = await queryRows<{
      market_id: string;
      wallet_identity_id: string;
      market_agent_id: string;
      final_decision_side: string | null;
      decision_confidence: number | null;
      decision_recorded_at: string | null;
      stake_usdc: string;
      position_count: number;
    }>(
      this.db,
      `
        SELECT
          up.market_id,
          up.wallet_identity_id,
          up.market_agent_id,
          ma.final_decision_side,
          COALESCE(final_decision.confidence, latest_decision.confidence) AS decision_confidence,
          COALESCE(final_decision.decided_at, latest_decision.decided_at)::text AS decision_recorded_at,
          SUM(up.stake_usdc)::text AS stake_usdc,
          COUNT(*)::integer AS position_count
        FROM user_positions up
        JOIN market_agents ma ON ma.id = up.market_agent_id
        LEFT JOIN agent_market_decisions final_decision
          ON final_decision.id = ma.finalized_from_decision_id
        LEFT JOIN LATERAL (
          SELECT d.confidence, d.decided_at
          FROM agent_market_decisions d
          WHERE d.market_agent_id = ma.id
          ORDER BY d.sequence_no DESC, d.decided_at DESC
          LIMIT 1
        ) latest_decision ON final_decision.id IS NULL
        WHERE up.market_id = ANY($1::text[])
          AND up.status IN ('open', 'settled')
        GROUP BY
          up.market_id,
          up.wallet_identity_id,
          up.market_agent_id,
          ma.final_decision_side,
          COALESCE(final_decision.confidence, latest_decision.confidence),
          COALESCE(final_decision.decided_at, latest_decision.decided_at)
      `,
      [uniqueMarketIds],
    );
    const positionsByMarketId = new Map<
      string,
      Array<{
        payout_key: string;
        wallet_identity_id: string;
        market_agent_id: string;
        final_decision_side: string | null;
        decision_confidence: number | null;
        decision_recorded_at: string | null;
        stakeUnits: bigint;
        position_count: number;
      }>
    >();

    for (const row of positionRows) {
      const entries = positionsByMarketId.get(row.market_id) ?? [];
      entries.push({
        payout_key: `${row.wallet_identity_id}:${row.market_agent_id}`,
        wallet_identity_id: row.wallet_identity_id,
        market_agent_id: row.market_agent_id,
        final_decision_side: row.final_decision_side,
        decision_confidence: row.decision_confidence,
        decision_recorded_at: row.decision_recorded_at,
        stakeUnits: this.parseTokenUnits(row.stake_usdc, 12),
        position_count: Number(row.position_count),
      });
      positionsByMarketId.set(row.market_id, entries);
    }

    const breakdownByPositionKey = new Map<
      string,
      {
        stake_return_usdc: string;
        base_pool_winnings_usdc: string;
        top_agent_bonus_usdc: string;
        gross_usdc: string;
        fee_usdc: string;
        net_usdc: string;
      }
    >();

    for (const row of marketOutcomeRows) {
      if (!isMarketOutcome(row.final_outcome)) {
        continue;
      }

      const positions = positionsByMarketId.get(row.market_id) ?? [];
      if (positions.length === 0) {
        continue;
      }

      const payoutPlan = buildHybridPayoutBreakdownByPositionKey({
        positions,
        outcome: row.final_outcome,
        topAgentBonusBps: this.env.PAYOUT_TOP_AGENT_BONUS_BPS,
        payoutFeeBps: this.env.PAYOUT_FEE_BPS,
      });

      for (const [positionKey, breakdown] of payoutPlan.breakdownByPositionKey) {
        if (!positionKey.startsWith(`${walletIdentityId}:`)) {
          continue;
        }

        breakdownByPositionKey.set(positionKey, {
          stake_return_usdc: formatSettlementDecimalUnits(
            breakdown.principal_units,
          ),
          base_pool_winnings_usdc: formatSettlementDecimalUnits(
            breakdown.base_pool_winnings_units,
          ),
          top_agent_bonus_usdc: formatSettlementDecimalUnits(
            breakdown.top_agent_bonus_units,
          ),
          gross_usdc: formatSettlementDecimalUnits(breakdown.gross_units),
          fee_usdc: formatSettlementDecimalUnits(breakdown.fee_units),
          net_usdc: formatSettlementDecimalUnits(breakdown.net_units),
        });
      }
    }

    return breakdownByPositionKey;
  }

  private formatTokenUnits(value: bigint, decimals: number) {
    if (decimals <= 0) {
      return value.toString();
    }

    const scale = 10n ** BigInt(decimals);
    const wholePart = value / scale;
    const fractionalPart = (value % scale)
      .toString()
      .padStart(decimals, "0")
      .replace(/0+$/, "");

    return fractionalPart
      ? `${wholePart.toString()}.${fractionalPart}`
      : wholePart.toString();
  }

  private parseTokenUnits(value: string, decimals: number) {
    const normalized = value.trim();
    const parts = normalized.split(".");
    const wholePart = parts[0] ?? "0";
    const fractionalPart = parts[1] ?? "";
    const scale = 10n ** BigInt(decimals);

    return (
      BigInt(wholePart) * scale +
      BigInt(fractionalPart.padEnd(decimals, "0"))
    );
  }
}

function isMarketOutcome(value: string | null | undefined): value is "YES" | "NO" {
  return value === "YES" || value === "NO";
}
