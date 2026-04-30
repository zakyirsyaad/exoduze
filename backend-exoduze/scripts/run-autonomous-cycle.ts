import { closeDatabase, createDatabase } from "../src/db/database.js";
import { queryRows } from "../src/db/query.js";
import { env } from "../src/config/env.js";
import { FeedService } from "../src/modules/feed/feed.service.js";
import { AutonomousMarketRunner } from "../src/modules/markets/autonomous-market-runner.js";
import { MarketGeneratorService } from "../src/modules/markets/market-generator.js";
import { MarketsService } from "../src/modules/markets/markets.service.js";
import { OracleResolverService } from "../src/modules/markets/oracle-resolver.js";
import { ResolutionFinalizerService } from "../src/modules/markets/resolution-finalizer.js";
import { ExoduzeOnchainService } from "../src/modules/onchain/exoduze-onchain.service.js";
import { TopicSnapshotsService } from "../src/modules/topics/topic-snapshots.js";

type RecentMarketRow = {
  id: string;
  slug: string;
  title: string;
  status: string;
  onchain_market_pubkey: string | null;
  category_slug: string;
  copy_provider: string | null;
  used_copy_fallback: string | null;
  news_hook: string | null;
  created_at: string;
};

const db = createDatabase(env);
const logger = {
  info(input: unknown, message?: string) {
    console.log(JSON.stringify({ level: "info", message, data: input }));
  },
  warn(input: unknown, message?: string) {
    console.warn(JSON.stringify({ level: "warn", message, data: input }));
  },
  error(input: unknown, message?: string) {
    console.error(JSON.stringify({ level: "error", message, data: input }));
  },
};

const onchainService = new ExoduzeOnchainService(env);
const feedService = new FeedService(db, env, logger);
const topicSnapshotsService = new TopicSnapshotsService(db);
const marketGeneratorService = new MarketGeneratorService(db, env);
const marketsService = new MarketsService(db, env, onchainService);
const oracleResolverService = new OracleResolverService(db, env, logger);
const resolutionFinalizerService = new ResolutionFinalizerService(
  db,
  env,
  marketsService,
  onchainService,
  logger,
);
const runner = new AutonomousMarketRunner(
  db,
  env,
  topicSnapshotsService,
  marketGeneratorService,
  marketsService,
  oracleResolverService,
  resolutionFinalizerService,
  logger,
);

const requestedCategories = process.argv
  .slice(2)
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const refreshCategories = requestedCategories.length > 0
  ? requestedCategories
  : env.AUTONOMOUS_MARKET_CATEGORIES.split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);

const startedAt = new Date().toISOString();

try {
  await db.query("SELECT 1");

  const before = await queryCount();
  const refreshed: string[] = [];

  for (const category of refreshCategories) {
    try {
      await feedService.refreshFeed({ category, force: true });
      refreshed.push(category);
    } catch (error) {
      logger.warn(
        { category, err: error instanceof Error ? error.message : error },
        "Feed refresh failed for category.",
      );
    }
  }

  await runner.runOnce(new Date());

  const after = await queryCount();
  const recentMarkets = await queryRows<RecentMarketRow>(
    db,
    `
      SELECT
        m.id,
        m.slug,
        m.title,
        m.status,
        m.onchain_market_pubkey,
        c.slug AS category_slug,
        m.context_json->>'copy_provider' AS copy_provider,
        m.context_json->>'used_copy_fallback' AS used_copy_fallback,
        m.context_json->>'news_hook' AS news_hook,
        m.created_at::text
      FROM markets m
      JOIN categories c ON c.id = m.category_id
      WHERE m.created_by = 'ai_generator'
        AND m.created_at >= $1::timestamptz
      ORDER BY m.created_at DESC
    `,
    [startedAt],
  );

  console.log(
    JSON.stringify(
      {
        started_at: startedAt,
        refreshed_categories: refreshed,
        market_count_before: before,
        market_count_after: after,
        markets_created_this_run: recentMarkets.length,
        recent_markets: recentMarkets,
      },
      null,
      2,
    ),
  );
} finally {
  await closeDatabase(db);
}

async function queryCount() {
  const result = await db.query("SELECT COUNT(*)::int AS count FROM markets");
  return Number(result.rows[0]?.count ?? 0);
}
