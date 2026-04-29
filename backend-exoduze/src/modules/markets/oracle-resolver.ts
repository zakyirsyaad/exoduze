import type { QueryResultRow } from "pg";

import type { Env } from "../../config/env.js";
import type { AppDatabase } from "../../db/database.js";
import { queryOne, queryRows } from "../../db/query.js";
import { createStableId } from "../../lib/ids.js";
import {
  getTopicRankFromSnapshot,
  TopicSnapshotsService,
} from "../topics/topic-snapshots.js";

type ResolverLogger = {
  info?: (input: unknown, message?: string) => void;
  warn?: (input: unknown, message?: string) => void;
  error?: (input: unknown, message?: string) => void;
};

type EligibleMarketRow = QueryResultRow & {
  id: string;
  slug: string;
  title: string;
  status: string;
  cutoff_at: string;
  required_rank: number | string;
  category_slug: string;
  category_name: string;
  topic_slug: string;
  topic_name: string;
};

type ExistingResolutionRow = QueryResultRow & {
  id: string;
  status: string;
};

export type ResolveMarketsResult = {
  marketsChecked: number;
  resolutionsProposed: number;
  skipped: number;
  errors: Array<{
    marketId: string;
    marketSlug: string;
    message: string;
  }>;
};

export class OracleResolverService {
  private readonly snapshots: TopicSnapshotsService;

  constructor(
    private readonly db: AppDatabase,
    private readonly env: Env,
    private readonly logger?: ResolverLogger,
  ) {
    this.snapshots = new TopicSnapshotsService(db);
  }

  async resolveMarkets(now = new Date()): Promise<ResolveMarketsResult> {
    if (!this.env.ORACLE_RESOLUTION_ENABLED) {
      this.logger?.info?.(
        { enabled: false },
        "Oracle resolution job skipped because ORACLE_RESOLUTION_ENABLED is false.",
      );
      return {
        marketsChecked: 0,
        resolutionsProposed: 0,
        skipped: 0,
        errors: [],
      };
    }

    const markets = await this.findEligibleMarkets(now);
    let resolutionsProposed = 0;
    let skipped = 0;
    const errors: ResolveMarketsResult["errors"] = [];

    for (const market of markets) {
      try {
        const proposed = await this.resolveMarket(market, now);
        if (proposed) {
          resolutionsProposed += 1;
        } else {
          skipped += 1;
        }
      } catch (error) {
        skipped += 1;
        const message =
          error instanceof Error
            ? error.message
            : "Unknown oracle resolution error.";
        errors.push({
          marketId: market.id,
          marketSlug: market.slug,
          message,
        });
        this.logger?.error?.(
          { err: error, marketId: market.id, marketSlug: market.slug },
          "Oracle failed while processing an eligible market.",
        );
      }
    }

    return {
      marketsChecked: markets.length,
      resolutionsProposed,
      skipped,
      errors,
    };
  }

  private async findEligibleMarkets(now: Date) {
    return queryRows<EligibleMarketRow>(
      this.db,
      `
        SELECT
          m.id,
          m.slug,
          m.title,
          m.status,
          COALESCE(m.cutoff_at, m.decision_cutoff_at)::text AS cutoff_at,
          m.required_rank,
          c.slug AS category_slug,
          c.name AS category_name,
          t.slug AS topic_slug,
          t.name AS topic_name
        FROM markets m
        JOIN categories c ON c.id = m.category_id
        JOIN market_topics mt ON mt.market_id = m.id AND mt.is_primary = true
        JOIN topics t ON t.id = mt.topic_id
        WHERE m.status IN ('open', 'locked', 'closed', 'resolving')
          AND COALESCE(m.cutoff_at, m.decision_cutoff_at) <= $1::timestamptz
          AND COALESCE(m.resolution_source, '') = 'topic_snapshots'
          AND COALESCE(m.outcome_type, 'YES_NO') = 'YES_NO'
        ORDER BY COALESCE(m.cutoff_at, m.decision_cutoff_at) ASC
      `,
      [now.toISOString()],
    );
  }

  private async resolveMarket(market: EligibleMarketRow, now: Date) {
    const existing = await queryOne<ExistingResolutionRow>(
      this.db,
      `
        SELECT id, status
        FROM market_resolutions
        WHERE market_id = $1
          AND status IN ('proposed', 'disputed', 'finalized')
        LIMIT 1
      `,
      [market.id],
    );

    if (existing) {
      this.logger?.info?.(
        {
          marketId: market.id,
          marketSlug: market.slug,
          resolutionId: existing.id,
          status: existing.status,
        },
        "Oracle resolution skipped because a resolution already exists.",
      );
      return false;
    }

    const snapshot = await this.snapshots.getFirstValidSnapshotAfter({
      category: market.category_slug,
      cutoffAt: market.cutoff_at,
      windowHours: 24,
    });

    if (!snapshot) {
      this.logger?.info?.(
        {
          marketId: market.id,
          marketSlug: market.slug,
          category: market.category_slug,
          cutoffAt: market.cutoff_at,
        },
        "Oracle resolution skipped because no valid snapshot exists yet.",
      );
      return false;
    }

    const requiredRank = Number(market.required_rank);
    const oracleOutcome = determineOracleOutcome(
      snapshot,
      market.topic_slug,
      requiredRank,
    );
    if (!oracleOutcome) {
      return false;
    }

    const rank = oracleOutcome.rank;
    const proposedOutcome = oracleOutcome.outcome;
    const evidenceSummary = buildEvidenceSummary({
      proposedOutcome,
      topicName: market.topic_name,
      categoryName: market.category_name,
      generatedAt: snapshot.generated_at,
      rank,
      requiredRank,
    });
    const disputeWindowMinutes = this.env.AUTONOMOUS_MARKET_ENABLED
      ? this.env.AUTONOMOUS_RESOLUTION_DISPUTE_WINDOW_MINUTES
      : this.env.MARKET_DISPUTE_WINDOW_MINUTES;
    const disputeDeadline = new Date(
      now.getTime() + disputeWindowMinutes * 60_000,
    ).toISOString();
    const resolutionId = createStableId(
      "mres",
      `${market.id}:${snapshot.id}:oracle_bot`,
    );

    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM markets WHERE id = $1 FOR UPDATE", [
        market.id,
      ]);

      const current = await queryOne<ExistingResolutionRow>(
        client,
        `
          SELECT id, status
          FROM market_resolutions
          WHERE market_id = $1
            AND status IN ('proposed', 'disputed', 'finalized')
          LIMIT 1
        `,
        [market.id],
      );

      if (current) {
        await client.query("ROLLBACK");
        return false;
      }

      await client.query(
        `
          INSERT INTO market_resolutions (
            id,
            market_id,
            proposed_outcome,
            evidence_snapshot_id,
            evidence_summary,
            proposed_by,
            proposed_at,
            dispute_deadline,
            status,
            created_at,
            updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, 'oracle_bot', $6, $7, 'proposed', now(), now()
          )
        `,
        [
          resolutionId,
          market.id,
          proposedOutcome,
          snapshot.id,
          evidenceSummary,
          now.toISOString(),
          disputeDeadline,
        ],
      );

      await client.query(
        `
          UPDATE markets
          SET status = 'resolving', updated_at = now()
          WHERE id = $1 AND status NOT IN ('resolved', 'disputed', 'cancelled')
        `,
        [market.id],
      );

      await client.query("COMMIT");

      this.logger?.info?.(
        {
          marketId: market.id,
          marketSlug: market.slug,
          resolutionId,
          proposedOutcome,
          snapshotId: snapshot.id,
        },
        "Oracle proposed market resolution.",
      );
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      this.logger?.error?.(
        { err: error, marketId: market.id },
        "Oracle failed to propose market resolution.",
      );
      throw error;
    } finally {
      client.release();
    }
  }
}

export function buildEvidenceSummary({
  proposedOutcome,
  topicName,
  categoryName,
  generatedAt,
  rank,
  requiredRank,
}: {
  proposedOutcome: "YES" | "NO";
  topicName: string;
  categoryName: string;
  generatedAt: string;
  rank: number | null;
  requiredRank: number;
}) {
  if (rank === null) {
    return `Oracle proposed ${proposedOutcome} because ${topicName} did not appear in the ${categoryName} 24h snapshot generated at ${generatedAt}. Required rank: top ${requiredRank}.`;
  }

  return `Oracle proposed ${proposedOutcome} because ${topicName} ranked #${rank} in the ${categoryName} 24h snapshot generated at ${generatedAt}. Required rank: top ${requiredRank}.`;
}

export function determineOracleOutcome(
  snapshot: Parameters<typeof getTopicRankFromSnapshot>[0] | null,
  topicSlugOrName: string,
  requiredRank: number,
) {
  if (!snapshot) {
    return null;
  }

  const rank = getTopicRankFromSnapshot(snapshot, topicSlugOrName);
  return {
    rank,
    outcome: (rank !== null && rank <= requiredRank ? "YES" : "NO") as
      | "YES"
      | "NO",
  };
}

export function isActiveResolutionStatus(status: string) {
  return ["proposed", "disputed", "finalized"].includes(status);
}
