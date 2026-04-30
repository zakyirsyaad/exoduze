import { closeDatabase, createDatabase } from "../src/db/database.js";
import { env } from "../src/config/env.js";
import { FeedService } from "../src/modules/feed/feed.service.js";
import { MarketGeneratorService } from "../src/modules/markets/market-generator.js";
import { MarketsService } from "../src/modules/markets/markets.service.js";
import { ExoduzeOnchainService } from "../src/modules/onchain/exoduze-onchain.service.js";
import { TopicSnapshotsService } from "../src/modules/topics/topic-snapshots.js";

const db = createDatabase(env);
const logger = {
  error(input: unknown, message?: string) {
    console.error(JSON.stringify({ level: "error", message, data: input }));
  },
};

const requestedCategories = process.argv
  .slice(2)
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const categories = requestedCategories.length > 0
  ? requestedCategories
  : ["finance"];

const feedService = new FeedService(db, env, logger);
const topicSnapshotsService = new TopicSnapshotsService(db);
const marketGeneratorService = new MarketGeneratorService(db, env);
const onchainService = new ExoduzeOnchainService(env);
const marketsService = new MarketsService(db, env, onchainService);

try {
  const results: Array<Record<string, unknown>> = [];

  for (const category of categories) {
    await feedService.refreshFeed({ category, force: true });
    const snapshot = await topicSnapshotsService.saveLatestHotTopicSnapshot(
      category,
      env.AUTONOMOUS_SNAPSHOT_TOPIC_LIMIT,
    );
    const generated = await marketGeneratorService.createMarketsFromSnapshot({
      snapshot,
      opensAt: new Date().toISOString(),
      requiredRank: env.AUTONOMOUS_MARKET_REQUIRED_RANK,
      createdBy: "ai_generator",
      generatedReason: `News-led AI publish flow generated this market from topic snapshot ${snapshot.id}.`,
      maxMarkets: env.AUTONOMOUS_MARKET_MAX_MARKETS_PER_CATEGORY,
      minConfidence: env.AUTONOMOUS_MARKET_MIN_TOPIC_CONFIDENCE,
      skipIfActiveMarketExists: false,
    });

    const published = [];
    for (const market of generated.markets) {
      const onchain = await marketsService.publishMarketOnchain(market.id);
      published.push({
        id: market.id,
        slug: market.slug,
        title: market.title,
        onchain_publish: onchain.data.onchain_publish,
      });
    }

    results.push({
      category,
      snapshot_id: snapshot.id,
      markets_created: generated.marketsCreated,
      markets_skipped: generated.skipped,
      published,
    });
  }

  console.log(
    JSON.stringify(
      {
        run_at: new Date().toISOString(),
        categories,
        results,
      },
      null,
      2,
    ),
  );
} finally {
  await closeDatabase(db);
}
