import type { QueryResultRow } from "pg";

import type { Env } from "../../config/env.js";
import type { AppDatabase } from "../../db/database.js";
import { queryOne, queryRows } from "../../db/query.js";
import { createStableId } from "../../lib/ids.js";
import { writeAuditLog } from "../audit/audit-log.js";
import type { ExoduzeOnchainService } from "../onchain/exoduze-onchain.service.js";
import { MarketsService } from "./markets.service.js";

type FinalizerLogger = {
  info?: (input: unknown, message?: string) => void;
  warn?: (input: unknown, message?: string) => void;
  error?: (input: unknown, message?: string) => void;
};

type ProposedResolutionRow = QueryResultRow & {
  id: string;
  market_id: string;
  proposed_outcome: "YES" | "NO";
  evidence_snapshot_id: string;
  evidence_summary: string;
  status: string;
  dispute_deadline: string;
  updated_at: string;
  market_oracle_source: string;
  market_status: string;
  onchain_market_pubkey: string | null;
  onchain_settlement_tx_sig: string | null;
  onchain_settled_at: string | null;
};

export type FinalizeResolutionsResult = {
  resolutionsFinalized: number;
  skipped: number;
  errors: Array<{
    resolutionId: string;
    marketId: string;
    message: string;
  }>;
};

export class ResolutionFinalizerService {
  private static readonly SETTLING_RETRY_AFTER_MS = 5 * 60 * 1000;

  constructor(
    private readonly db: AppDatabase,
    private readonly env: Env,
    private readonly marketsService: MarketsService,
    private readonly onchainService?: ExoduzeOnchainService,
    private readonly logger?: FinalizerLogger,
  ) {}

  async finalizeResolutions(now = new Date()): Promise<FinalizeResolutionsResult> {
    if (!this.env.ORACLE_RESOLUTION_ENABLED) {
      this.logger?.info?.(
        { enabled: false },
        "Resolution finalizer skipped because ORACLE_RESOLUTION_ENABLED is false.",
      );
      return {
        resolutionsFinalized: 0,
        skipped: 0,
        errors: [],
      };
    }

    const candidates = await queryRows<ProposedResolutionRow>(
      this.db,
      `
        SELECT
          mr.id,
          mr.market_id,
          mr.proposed_outcome,
          mr.evidence_snapshot_id,
          mr.evidence_summary,
          mr.status,
          mr.dispute_deadline::text,
          mr.updated_at::text,
          m.oracle_source AS market_oracle_source,
          m.status AS market_status,
          m.onchain_market_pubkey,
          mr.onchain_settlement_tx_sig,
          mr.onchain_settled_at::text
        FROM market_resolutions mr
        JOIN markets m ON m.id = mr.market_id
        WHERE (
            (mr.status = 'proposed' AND mr.dispute_deadline <= $1::timestamptz)
            OR (mr.status = 'settling' AND mr.updated_at <= $2::timestamptz)
          )
          AND m.status NOT IN ('resolved', 'disputed', 'cancelled')
        ORDER BY COALESCE(mr.finalized_at, mr.dispute_deadline) ASC, mr.updated_at ASC
      `,
      [
        now.toISOString(),
        new Date(
          now.getTime() - ResolutionFinalizerService.SETTLING_RETRY_AFTER_MS,
        ).toISOString(),
      ],
    );

    let resolutionsFinalized = 0;
    let skipped = 0;
    const errors: FinalizeResolutionsResult["errors"] = [];

    for (const candidate of candidates) {
      try {
        const finalized = await this.finalizeResolution(candidate, now);
        if (finalized) {
          resolutionsFinalized += 1;
        } else {
          skipped += 1;
        }
      } catch (error) {
        skipped += 1;
        const message =
          error instanceof Error
            ? error.message
            : "Unknown resolution finalizer error.";
        errors.push({
          resolutionId: candidate.id,
          marketId: candidate.market_id,
          message,
        });
        this.logger?.error?.(
          { err: error, resolutionId: candidate.id, marketId: candidate.market_id },
          "Resolution finalizer failed while processing a candidate.",
        );
      }
    }

    return {
      resolutionsFinalized,
      skipped,
      errors,
    };
  }

  private async finalizeResolution(
    resolution: ProposedResolutionRow,
    now: Date,
  ) {
    const resolvedAt = now.toISOString();
    const claimedResolution = await this.claimResolutionForSettlement(
      resolution,
      now,
    );
    if (!claimedResolution) {
      return false;
    }
    await writeAuditLog(this.db, this.logger, {
      action: "resolution_settlement.attempted",
      actorType: "system",
      entityType: "market_resolution",
      entityId: claimedResolution.id,
      after: {
        market_id: claimedResolution.market_id,
        outcome: claimedResolution.proposed_outcome,
        onchain_required: Boolean(
          this.env.AUTONOMOUS_RESOLVE_ONCHAIN &&
            claimedResolution.onchain_market_pubkey,
        ),
      },
    });

    let onchainResolution: Awaited<
      ReturnType<ResolutionFinalizerService["resolveMarketOnchainIfNeeded"]>
    > = null;

    try {
      onchainResolution = await this.resolveMarketOnchainIfNeeded(
        claimedResolution,
        resolvedAt,
      );
      const finalized = await this.marketsService.finalizeAutomaticResolution({
        resolutionId: claimedResolution.id,
        marketId: claimedResolution.market_id,
        outcome: claimedResolution.proposed_outcome,
        evidenceUri: `topic_snapshot:${claimedResolution.evidence_snapshot_id}`,
        submittedTxSig: onchainResolution?.tx_sig ?? null,
        resolvedAt,
        finalizedBy: "oracle_bot",
      });

      if (!finalized.finalized) {
        return false;
      }
      await writeAuditLog(this.db, this.logger, {
        action: "resolution_settlement.succeeded",
        actorType: "system",
        entityType: "market_resolution",
        entityId: claimedResolution.id,
        after: {
          market_id: claimedResolution.market_id,
          outcome: claimedResolution.proposed_outcome,
          onchain_tx_recorded: Boolean(onchainResolution?.tx_sig),
          payout_count: finalized.settlement?.payout_count ?? null,
        },
      });

      this.logger?.info?.(
        {
          resolutionId: claimedResolution.id,
          marketId: claimedResolution.market_id,
          outcome: claimedResolution.proposed_outcome,
          onchain_tx_sig: onchainResolution?.tx_sig ?? null,
        },
        "Resolution finalized automatically.",
      );
      return true;
    } catch (error) {
      await this.releaseResolutionForRetry(claimedResolution.id);
      await writeAuditLog(this.db, this.logger, {
        action: "resolution_settlement.failed",
        actorType: "system",
        entityType: "market_resolution",
        entityId: claimedResolution.id,
        after: {
          market_id: claimedResolution.market_id,
          outcome: claimedResolution.proposed_outcome,
          error: error instanceof Error ? error.message : "Unknown error",
        },
      });
      this.logger?.error?.(
        { err: error, resolutionId: claimedResolution.id },
        "Resolution finalizer failed.",
      );
      throw error;
    }
  }

  private async claimResolutionForSettlement(
    resolution: ProposedResolutionRow,
    now: Date,
  ): Promise<ProposedResolutionRow | null> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");

      const market = await queryOne<{ status: string }>(
        client,
        "SELECT status FROM markets WHERE id = $1 FOR UPDATE",
        [resolution.market_id],
      );

      if (!market || ["resolved", "disputed", "cancelled"].includes(market.status)) {
        await client.query("ROLLBACK");
        return null;
      }

      const currentResolution = await queryOne<{
        status: string;
        dispute_deadline: string;
        updated_at: string;
        onchain_settlement_tx_sig: string | null;
        onchain_settled_at: string | null;
      }>(
        client,
        `
          SELECT
            status,
            dispute_deadline::text,
            updated_at::text,
            onchain_settlement_tx_sig,
            onchain_settled_at::text
          FROM market_resolutions
          WHERE id = $1
          FOR UPDATE
          LIMIT 1
        `,
        [resolution.id],
      );

      if (
        !currentResolution ||
        ["disputed", "finalized", "rejected"].includes(currentResolution.status)
      ) {
        await client.query("ROLLBACK");
        return null;
      }

      if (currentResolution.status === "proposed") {
        if (Date.parse(currentResolution.dispute_deadline) > now.getTime()) {
          await client.query("ROLLBACK");
          return null;
        }

        const dispute = await queryOne<{ id: string }>(
          client,
          `
            SELECT id
            FROM market_disputes
            WHERE resolution_id = $1 AND status = 'open'
            LIMIT 1
          `,
          [resolution.id],
        );

        if (dispute) {
          await client.query("ROLLBACK");
          return null;
        }
      } else if (currentResolution.status === "settling") {
        const retryAfter = new Date(
          now.getTime() - ResolutionFinalizerService.SETTLING_RETRY_AFTER_MS,
        ).getTime();
        const updatedAt = Date.parse(currentResolution.updated_at);
        if (
          resolution.status !== "settling" ||
          Number.isNaN(updatedAt) ||
          updatedAt > retryAfter
        ) {
          await client.query("ROLLBACK");
          return null;
        }
      } else {
        await client.query("ROLLBACK");
        return null;
      }

      const updatedResolution = await queryOne<{
        onchain_settlement_tx_sig: string | null;
        onchain_settled_at: string | null;
        updated_at: string;
      }>(
        client,
        `
          UPDATE market_resolutions
          SET status = 'settling',
              updated_at = now()
          WHERE id = $1
            AND status IN ('proposed', 'settling')
          RETURNING
            onchain_settlement_tx_sig,
            onchain_settled_at::text,
            updated_at::text
        `,
        [resolution.id],
      );

      if (!updatedResolution) {
        await client.query("ROLLBACK");
        return null;
      }

      await client.query("COMMIT");

      return {
        ...resolution,
        status: "settling",
        updated_at: updatedResolution.updated_at,
        onchain_settlement_tx_sig:
          updatedResolution.onchain_settlement_tx_sig,
        onchain_settled_at: updatedResolution.onchain_settled_at,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async resolveMarketOnchainIfNeeded(
    resolution: ProposedResolutionRow,
    resolvedAt: string,
  ) {
    if (resolution.onchain_settled_at) {
      return {
        already_resolved: true,
        tx_sig: resolution.onchain_settlement_tx_sig,
        market_pubkey: resolution.onchain_market_pubkey,
        outcome: resolution.proposed_outcome,
      };
    }

    if (!this.env.AUTONOMOUS_RESOLVE_ONCHAIN) {
      return null;
    }

    if (!resolution.onchain_market_pubkey) {
      return null;
    }

    if (!this.onchainService) {
      throw new Error(
        "On-chain resolution is enabled but the on-chain service is not configured.",
      );
    }

    const ownedByCurrentProgram =
      await this.onchainService.isAccountOwnedByCurrentProgram(
        resolution.onchain_market_pubkey,
      );
    if (!ownedByCurrentProgram) {
      this.logger?.warn?.(
        {
          marketPubkey: resolution.onchain_market_pubkey,
          marketId: resolution.market_id,
          programId: this.onchainService.programId.toBase58(),
        },
        "Skipping on-chain resolve because the market account belongs to a different program.",
      );
      return null;
    }

    const result = await this.onchainService.resolveMarket({
      marketPubkey: resolution.onchain_market_pubkey,
      outcome: resolution.proposed_outcome,
    });
    await this.recordOnchainSettlement(resolution.id, result.tx_sig, resolvedAt);
    return result;
  }

  private async recordOnchainSettlement(
    resolutionId: string,
    txSig: string | null,
    settledAt: string,
  ) {
    await this.db.query(
      `
        UPDATE market_resolutions
        SET
          onchain_settlement_tx_sig = COALESCE($2, onchain_settlement_tx_sig),
          onchain_settled_at = COALESCE(onchain_settled_at, $3::timestamptz),
          updated_at = now()
        WHERE id = $1
          AND status = 'settling'
      `,
      [resolutionId, txSig, settledAt],
    );
  }

  private async releaseResolutionForRetry(resolutionId: string) {
    try {
      await this.db.query(
        `
          UPDATE market_resolutions
          SET status = 'proposed',
              updated_at = now()
          WHERE id = $1
            AND status = 'settling'
        `,
        [resolutionId],
      );
    } catch (error) {
      this.logger?.error?.(
        { err: error, resolutionId },
        "Failed to release resolution after settlement error.",
      );
    }
  }
}

export function isResolutionFinalizable(
  resolution: { status: string; disputeDeadline: string },
  now = new Date(),
) {
  if (resolution.status !== "proposed") {
    return false;
  }

  const disputeDeadlineMs = Date.parse(resolution.disputeDeadline);
  return !Number.isNaN(disputeDeadlineMs) && disputeDeadlineMs <= now.getTime();
}

export async function upsertConfirmedOracleResult(
  db: Pick<AppDatabase, "query">,
  input: {
    marketId: string;
    outcome: "YES" | "NO";
    oracleSource: string;
    evidenceUri: string | null;
    resolvedAt: string;
    submittedByWalletId: string | null;
  },
) {
  const oracleResultId = createStableId(
    "oracle",
    `${input.marketId}:${input.outcome}:automatic`,
  );

  await db.query(
    `
      INSERT INTO oracle_results (
        id,
        market_id,
        outcome,
        oracle_source,
        evidence_uri,
        submitted_by_wallet_id,
        submitted_tx_sig,
        status,
        resolved_at,
        created_at,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, NULL, 'confirmed', $7, now(), now()
      )
      ON CONFLICT (id) DO UPDATE
      SET
        outcome = excluded.outcome,
        oracle_source = excluded.oracle_source,
        evidence_uri = excluded.evidence_uri,
        submitted_by_wallet_id = COALESCE(excluded.submitted_by_wallet_id, oracle_results.submitted_by_wallet_id),
        status = 'confirmed',
        resolved_at = excluded.resolved_at,
        updated_at = now()
    `,
    [
      oracleResultId,
      input.marketId,
      input.outcome,
      input.oracleSource,
      input.evidenceUri,
      input.submittedByWalletId,
      input.resolvedAt,
    ],
  );

  return oracleResultId;
}
