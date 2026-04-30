import { closeDatabase, createDatabase } from "../src/db/database.js";
import { env } from "../src/config/env.js";
import { queryRows } from "../src/db/query.js";
import { MarketsService } from "../src/modules/markets/markets.service.js";
import { ExoduzeOnchainService } from "../src/modules/onchain/exoduze-onchain.service.js";

type EmptyTopicMarketRow = {
  id: string;
  slug: string;
  title: string;
  category_slug: string;
  topic_slug: string;
  status: string;
  onchain_market_pubkey: string | null;
  created_at: string;
};

const args = process.argv
  .slice(2)
  .map((value) => value.trim())
  .filter(Boolean);
const shouldApply = args.includes("--apply");
const marketIds = args.filter((value) => value !== "--apply");

const db = createDatabase(env);
const onchainService = new ExoduzeOnchainService(env);
const marketsService = new MarketsService(db, env, onchainService);

try {
  const markets = await loadEmptyTopicMarkets(marketIds);

  if (!shouldApply) {
    console.log(
      JSON.stringify(
        {
          apply: false,
          candidate_count: markets.length,
          markets,
        },
        null,
        2,
      ),
    );
  } else {
    const cancelled = [];
    const failed = [];

    for (const market of markets) {
      try {
        const result = await marketsService.deleteMarket(market.id);
        cancelled.push({
          id: market.id,
          slug: market.slug,
          title: market.title,
          category_slug: market.category_slug,
          topic_slug: market.topic_slug,
          onchain_market_pubkey: market.onchain_market_pubkey,
          onchain_cancel: result.data.onchain_cancel ?? null,
          status: result.data.status,
        });
      } catch (error) {
        failed.push({
          id: market.id,
          slug: market.slug,
          title: market.title,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const remaining = await loadEmptyTopicMarkets([]);
    console.log(
      JSON.stringify(
        {
          apply: true,
          candidate_count: markets.length,
          cancelled_count: cancelled.length,
          failed_count: failed.length,
          remaining_count: remaining.length,
          cancelled,
          failed,
        },
        null,
        2,
      ),
    );

    if (failed.length > 0) {
      process.exitCode = 1;
    }
  }
} finally {
  await closeDatabase(db);
}

async function loadEmptyTopicMarkets(marketIds: string[]) {
  const params: unknown[] = [];
  const where: string[] = [
    `COALESCE(m.resolution_source, '') = 'topic_snapshots'`,
    `m.final_outcome IS NULL`,
    `m.status NOT IN ('draft', 'resolved', 'cancelled')`,
    `COALESCE(jsonb_array_length(m.context_json->'linked_news'), 0) = 0`,
    `NOT EXISTS (
      SELECT 1
      FROM news_item_markets nim
      WHERE nim.market_id = m.id
    )`,
  ];

  if (marketIds.length > 0) {
    params.push(marketIds);
    where.push(`m.id = ANY($${params.length}::text[])`);
  }

  return queryRows<EmptyTopicMarketRow>(
    db,
    `
      SELECT
        m.id,
        m.slug,
        m.title,
        c.slug AS category_slug,
        t.slug AS topic_slug,
        m.status,
        m.onchain_market_pubkey,
        m.created_at::text
      FROM markets m
      JOIN categories c ON c.id = m.category_id
      JOIN market_topics mt ON mt.market_id = m.id AND mt.is_primary = true
      JOIN topics t ON t.id = mt.topic_id
      WHERE ${where.join(" AND ")}
      ORDER BY m.created_at ASC
    `,
    params,
  );
}
