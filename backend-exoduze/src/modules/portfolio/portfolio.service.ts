import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";

import type { Env } from "../../config/env.js";
import type { AppDatabase } from "../../db/database.js";
import { queryOne, queryRows } from "../../db/query.js";
import { HttpError } from "../../lib/http-error.js";
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

type RecordClaimInput = {
  txSig: string;
};

export class PortfolioService {
  private readonly connection: Connection;

  constructor(
    private readonly db: AppDatabase,
    private readonly env: Env,
    private readonly onchainService?: ExoduzeOnchainService,
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

    return {
      data: {
        wallet: {
          wallet_identity_id: wallet.id,
          wallet_address: wallet.wallet_address,
        },
        balances,
        user_participants: userParticipants,
        ai_battles: aiBattles,
        payouts,
      },
    };
  }

  async recordPayoutClaim(
    walletAddress: string,
    payoutId: string,
    input: RecordClaimInput,
  ) {
    const wallet = await this.requireWalletIdentity(walletAddress);
    const payout = await queryOne<{ id: string; status: string }>(
      this.db,
      `
        SELECT id, status
        FROM payouts
        WHERE id = $1 AND wallet_identity_id = $2
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
      throw new HttpError(409, "ONCHAIN_TX_FAILED", "The payout claim transaction failed.");
    }

    const status =
      signatureStatus && !signatureStatus.confirmed && signatureStatus.found
        ? "submitted"
        : "paid";
    const paidAt = status === "paid" ? new Date().toISOString() : null;

    await this.db.query(
      `
        UPDATE payouts
        SET
          payout_tx_sig = $3,
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

    return this.getPortfolio(wallet.wallet_address);
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
}
