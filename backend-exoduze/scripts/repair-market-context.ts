import { closeDatabase, createDatabase } from "../src/db/database.js";
import { env } from "../src/config/env.js";
import { queryRows } from "../src/db/query.js";
import { createStableId } from "../src/lib/ids.js";
import {
  buildTopicNewsContext,
  selectTopicNewsRows,
  type TopicNewsCandidate,
} from "../src/modules/markets/market-generator.js";
import { buildFallbackMarketCopy } from "../src/modules/markets/market-detail-generator.js";

type MarketRow = {
  id: string;
  slug: string;
  title: string;
  category_slug: string;
  category_name: string;
  topic_slug: string;
  topic_name: string;
  required_rank: number | string;
  cutoff_at: string;
  snapshot_id: string | null;
};

const db = createDatabase(env);
const args = process.argv
  .slice(2)
  .map((value) => value.trim())
  .filter(Boolean);

const snapshotFlagIndex = args.findIndex((value) => value === "--snapshot");
const repairAll = args.includes("--all-topic-snapshots");
const snapshotId =
  snapshotFlagIndex >= 0 ? args[snapshotFlagIndex + 1]?.trim() || null : null;
const marketIds = args.filter((value, index) => {
  if (value === "--all-topic-snapshots") {
    return false;
  }

  if (value === "--snapshot") {
    return false;
  }

  if (snapshotFlagIndex >= 0 && index === snapshotFlagIndex + 1) {
    return false;
  }

  return true;
});

if (!repairAll && !snapshotId && marketIds.length === 0) {
  console.error(
    "Provide market ids, pass --snapshot <topic_snapshot_id>, or use --all-topic-snapshots.",
  );
  process.exit(1);
}

try {
  const markets = await loadTargetMarkets({ repairAll, snapshotId, marketIds });
  const repaired = [];

  for (const market of markets) {
    const newsRows = await queryRows<TopicNewsCandidate>(
      db,
      `
        SELECT
          ni.id,
          ni.title,
          ni.summary,
          ni.url,
          ns.name AS source_name,
          ni.published_at::text,
          ni.is_breaking,
          COALESCE(ni.mention_weight, 0)::text AS relevance_score,
          false AS is_primary
        FROM categories c
        JOIN news_items ni ON ni.category_id = c.id
        JOIN news_sources ns ON ns.id = ni.source_id
        WHERE c.slug = $1
        ORDER BY
          ni.is_breaking DESC,
          COALESCE(ni.mention_weight, 0) DESC,
          ni.published_at DESC
        LIMIT 30
      `,
      [market.category_slug],
    );

    const topicRef = {
      name: market.topic_name,
      slug: market.topic_slug,
    };
    const linkedNews = buildTopicNewsContext(
      selectTopicNewsRows(newsRows, topicRef),
      topicRef,
    );
    const fallbackCopy = buildFallbackMarketCopy({
      topicName: market.topic_name,
      categoryName: market.category_name,
      requiredRank: Number(market.required_rank),
      cutoffAt: market.cutoff_at,
      news: linkedNews,
    });

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `
          DELETE FROM news_item_markets
          WHERE market_id = $1
        `,
        [market.id],
      );

      for (const newsItem of linkedNews) {
        await client.query(
          `
            INSERT INTO news_item_markets (
              id, news_item_id, market_id, relevance_score, created_at
            ) VALUES ($1, $2, $3, $4, now())
            ON CONFLICT (news_item_id, market_id) DO NOTHING
          `,
          [
            createStableId("nim", `${newsItem.id}:${market.id}`),
            newsItem.id,
            market.id,
            newsItem.relevanceScore,
          ],
        );
      }

      await client.query(
        `
          UPDATE markets
          SET
            context_json = COALESCE(context_json, '{}'::jsonb) || $2::jsonb,
            updated_at = now()
          WHERE id = $1
        `,
        [
          market.id,
          JSON.stringify({
            news_hook: fallbackCopy.newsHook,
            linked_news: linkedNews.map((item) => ({
              id: item.id,
              title: item.title,
              url: item.url,
              source_name: item.sourceName,
              published_at: item.publishedAt,
              is_breaking: item.isBreaking,
              relevance_score: item.relevanceScore,
            })),
          }),
        ],
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    repaired.push({
      id: market.id,
      slug: market.slug,
      title: market.title,
      snapshot_id: market.snapshot_id,
      news_hook: fallbackCopy.newsHook,
      linked_news_count: linkedNews.length,
    });
  }

  console.log(
    JSON.stringify(
      {
        repaired_count: repaired.length,
        repaired,
      },
      null,
      2,
    ),
  );
} finally {
  await closeDatabase(db);
}

async function loadTargetMarkets(input: {
  repairAll: boolean;
  snapshotId: string | null;
  marketIds: string[];
}) {
  if (input.repairAll) {
    return queryRows<MarketRow>(
      db,
      `
        SELECT
          m.id,
          m.slug,
          m.title,
          c.slug AS category_slug,
          c.name AS category_name,
          t.slug AS topic_slug,
          t.name AS topic_name,
          m.required_rank,
          COALESCE(m.cutoff_at, m.decision_cutoff_at)::text AS cutoff_at,
          m.context_json->>'snapshot_id' AS snapshot_id
        FROM markets m
        JOIN categories c ON c.id = m.category_id
        JOIN market_topics mt ON mt.market_id = m.id AND mt.is_primary = true
        JOIN topics t ON t.id = mt.topic_id
        WHERE COALESCE(m.resolution_source, '') = 'topic_snapshots'
        ORDER BY c.slug ASC, m.created_at DESC
      `,
    );
  }

  if (input.snapshotId) {
    return queryRows<MarketRow>(
      db,
      `
        SELECT
          m.id,
          m.slug,
          m.title,
          c.slug AS category_slug,
          c.name AS category_name,
          t.slug AS topic_slug,
          t.name AS topic_name,
          m.required_rank,
          COALESCE(m.cutoff_at, m.decision_cutoff_at)::text AS cutoff_at,
          m.context_json->>'snapshot_id' AS snapshot_id
        FROM markets m
        JOIN categories c ON c.id = m.category_id
        JOIN market_topics mt ON mt.market_id = m.id AND mt.is_primary = true
        JOIN topics t ON t.id = mt.topic_id
        WHERE m.context_json->>'snapshot_id' = $1
        ORDER BY m.created_at DESC
      `,
      [input.snapshotId],
    );
  }

  return queryRows<MarketRow>(
    db,
    `
      SELECT
        m.id,
        m.slug,
        m.title,
        c.slug AS category_slug,
        c.name AS category_name,
        t.slug AS topic_slug,
        t.name AS topic_name,
        m.required_rank,
        COALESCE(m.cutoff_at, m.decision_cutoff_at)::text AS cutoff_at,
        m.context_json->>'snapshot_id' AS snapshot_id
      FROM markets m
      JOIN categories c ON c.id = m.category_id
      JOIN market_topics mt ON mt.market_id = m.id AND mt.is_primary = true
      JOIN topics t ON t.id = mt.topic_id
      WHERE m.id = ANY($1::text[])
      ORDER BY m.created_at DESC
    `,
    [input.marketIds],
  );
}
