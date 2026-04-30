import type { QueryResultRow } from "pg";

import type { Env } from "../../config/env.js";
import type { AppDatabase } from "../../db/database.js";
import { queryOne, queryRows } from "../../db/query.js";
import { createStableId } from "../../lib/ids.js";
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
  market_oracle_source: string;
  market_status: string;
  onchain_market_pubkey: string | null;
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
          m.oracle_source AS market_oracle_source,
          m.status AS market_status,
          m.onchain_market_pubkey
        FROM market_resolutions mr
        JOIN markets m ON m.id = mr.market_id
        WHERE (
            (mr.status = 'proposed' AND mr.dispute_deadline <= $1::timestamptz)
            OR mr.status = 'finalized'
          )
          AND m.status NOT IN ('resolved', 'disputed', 'cancelled')
        ORDER BY COALESCE(mr.finalized_at, mr.dispute_deadline) ASC, mr.updated_at ASC
      `,
      [now.toISOString()],
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
        return false;
      }

      const currentResolution = await queryOne<{ status: string }>(
        client,
        `
          SELECT status
          FROM market_resolutions
          WHERE id = $1
          LIMIT 1
        `,
        [resolution.id],
      );

      if (!currentResolution || ["disputed", "rejected"].includes(currentResolution.status)) {
        await client.query("ROLLBACK");
        return false;
      }

      if (currentResolution.status === "proposed") {
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
          return false;
        }

        const updatedResolution = await client.query(
          `
            UPDATE market_resolutions
            SET
              status = 'finalized',
              finalized_outcome = proposed_outcome,
              finalized_at = $2,
              finalized_by = 'oracle_bot',
              updated_at = now()
            WHERE id = $1
              AND status = 'proposed'
              AND dispute_deadline <= $2::timestamptz
          `,
          [resolution.id, resolvedAt],
        );

        if (Number(updatedResolution.rowCount ?? 0) === 0) {
          await client.query("ROLLBACK");
          return false;
        }
      }

      await client.query("COMMIT");

      const onchainResolution = await this.resolveMarketOnchainIfNeeded(
        resolution,
      );
      await this.marketsService.resolveMarket(resolution.market_id, {
        outcome: resolution.proposed_outcome,
        evidenceUri: `topic_snapshot:${resolution.evidence_snapshot_id}`,
        submittedTxSig: onchainResolution?.tx_sig ?? null,
        resolvedAt,
        submittedByWalletId: null,
      });

      this.logger?.info?.(
        {
          resolutionId: resolution.id,
          marketId: resolution.market_id,
          outcome: resolution.proposed_outcome,
          onchain_tx_sig: onchainResolution?.tx_sig ?? null,
        },
        "Resolution finalized automatically.",
      );
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      this.logger?.error?.(
        { err: error, resolutionId: resolution.id },
        "Resolution finalizer failed.",
      );
      throw error;
    } finally {
      client.release();
    }
  }

  private async resolveMarketOnchainIfNeeded(
    resolution: ProposedResolutionRow,
  ) {
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

    return this.onchainService.resolveMarket({
      marketPubkey: resolution.onchain_market_pubkey,
      outcome: resolution.proposed_outcome,
    });
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
