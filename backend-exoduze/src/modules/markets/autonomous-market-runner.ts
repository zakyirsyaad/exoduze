import type { AppDatabase } from "../../db/database.js";
import { queryRows } from "../../db/query.js";
import { HttpError } from "../../lib/http-error.js";
import type { Env } from "../../config/env.js";
import { MarketGeneratorService } from "./market-generator.js";
import { MarketsService } from "./markets.service.js";
import { OracleResolverService } from "./oracle-resolver.js";
import { ResolutionFinalizerService } from "./resolution-finalizer.js";
import { TopicSnapshotsService } from "../topics/topic-snapshots.js";

type AutonomousRunnerLogger = {
  info?: (input: unknown, message?: string) => void;
  warn?: (input: unknown, message?: string) => void;
  error?: (input: unknown, message?: string) => void;
};

type UnpublishedMarketRow = {
  id: string;
  slug: string;
};

export class AutonomousMarketRunner {
  private intervalHandle: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly db: AppDatabase,
    private readonly env: Env,
    private readonly topicSnapshotsService: TopicSnapshotsService,
    private readonly marketGeneratorService: MarketGeneratorService,
    private readonly marketsService: MarketsService,
    private readonly oracleResolverService: OracleResolverService,
    private readonly resolutionFinalizerService: ResolutionFinalizerService,
    private readonly logger?: AutonomousRunnerLogger,
  ) {}

  start() {
    if (!this.env.AUTONOMOUS_MARKET_ENABLED) {
      this.logger?.info?.(
        { enabled: false },
        "Autonomous market runner is disabled.",
      );
      return;
    }

    const intervalMs = this.env.AUTONOMOUS_MARKET_INTERVAL_SECONDS * 1000;
    const runSafely = async () => {
      if (this.running) {
        this.logger?.warn?.(
          { interval_seconds: this.env.AUTONOMOUS_MARKET_INTERVAL_SECONDS },
          "Autonomous market runner skipped because a previous run is still active.",
        );
        return;
      }

      this.running = true;
      try {
        await this.runOnce();
      } catch (error) {
        this.logger?.error?.(
          { err: error },
          "Autonomous market runner failed.",
        );
      } finally {
        this.running = false;
      }
    };

    this.intervalHandle = setInterval(() => {
      void runSafely();
    }, intervalMs);

    void runSafely();
    this.logger?.info?.(
      {
        interval_seconds: this.env.AUTONOMOUS_MARKET_INTERVAL_SECONDS,
        categories: parseCategoryList(this.env.AUTONOMOUS_MARKET_CATEGORIES),
      },
      "Autonomous market runner started.",
    );
  }

  stop() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  async runOnce(now = new Date()) {
    const categories = await this.getTargetCategories();
    let snapshotsCreated = 0;
    let marketsCreated = 0;
    let marketsSkipped = 0;
    let marketsPublished = 0;

    if (this.env.MARKET_GENERATION_ENABLED) {
      for (const category of categories) {
        try {
          const snapshot = await this.topicSnapshotsService.saveLatestHotTopicSnapshot(
            category,
            this.env.AUTONOMOUS_SNAPSHOT_TOPIC_LIMIT,
          );
          if (!snapshot) {
            this.logger?.warn?.(
              { category },
              "Autonomous market runner did not receive a persisted snapshot row.",
            );
            continue;
          }
          snapshotsCreated += 1;

          const generated = await this.marketGeneratorService.createMarketsFromSnapshot({
            snapshot,
            opensAt: now.toISOString(),
            requiredRank: this.env.AUTONOMOUS_MARKET_REQUIRED_RANK,
            createdBy: "ai_generator",
            generatedReason: `Autonomous runner generated this market from topic snapshot ${snapshot.id}.`,
            maxMarkets: this.env.AUTONOMOUS_MARKET_MAX_MARKETS_PER_CATEGORY,
            minConfidence: this.env.AUTONOMOUS_MARKET_MIN_TOPIC_CONFIDENCE,
            skipIfActiveMarketExists: true,
          });

          marketsCreated += generated.marketsCreated;
          marketsSkipped += generated.skipped;
        } catch (error) {
          if (
            error instanceof HttpError &&
            error.code === "HOT_TOPICS_NOT_FOUND"
          ) {
            this.logger?.warn?.(
              { category },
              "Autonomous market runner skipped a category because no hot topics were available.",
            );
            continue;
          }

          throw error;
        }
      }
    }

    if (this.env.AUTONOMOUS_AUTO_PUBLISH_ONCHAIN) {
      const unpublishedMarkets = await this.findUnpublishedMarkets(
        this.env.AUTONOMOUS_PUBLISH_BATCH_SIZE,
      );

      for (const market of unpublishedMarkets) {
        try {
          await this.marketsService.publishMarketOnchain(market.id);
          marketsPublished += 1;
        } catch (error) {
          this.logger?.error?.(
            { err: error, marketId: market.id, marketSlug: market.slug },
            "Autonomous market runner failed to publish a market on-chain.",
          );
        }
      }
    }

    const resolved = await this.oracleResolverService.resolveMarkets(now);
    const finalized = await this.resolutionFinalizerService.finalizeResolutions(now);

    this.logger?.info?.(
      {
        categories,
        snapshots_created: snapshotsCreated,
        markets_created: marketsCreated,
        markets_skipped: marketsSkipped,
        markets_published: marketsPublished,
        resolutions_proposed: resolved.resolutionsProposed,
        resolutions_finalized: finalized.resolutionsFinalized,
      },
      "Autonomous market runner completed a cycle.",
    );
  }

  private async getTargetCategories() {
    const configuredCategories = parseCategoryList(
      this.env.AUTONOMOUS_MARKET_CATEGORIES,
    );
    if (configuredCategories.length > 0) {
      return configuredCategories;
    }

    const rows = await queryRows<{ slug: string }>(
      this.db,
      `
        SELECT DISTINCT c.slug
        FROM hot_topic_snapshots hts
        JOIN categories c ON c.id = hts.category_id
        WHERE c.is_active = true
        ORDER BY c.slug ASC
      `,
    );

    return rows.map((row) => row.slug);
  }

  private async findUnpublishedMarkets(limit: number) {
    return queryRows<UnpublishedMarketRow>(
      this.db,
      `
        SELECT id, slug
        FROM markets
        WHERE onchain_market_pubkey IS NULL
          AND final_outcome IS NULL
          AND status NOT IN ('draft', 'resolved', 'cancelled')
        ORDER BY created_at ASC
        LIMIT $1
      `,
      [limit],
    );
  }
}

function parseCategoryList(value: string) {
  return [...new Set(
    value
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  )];
}
