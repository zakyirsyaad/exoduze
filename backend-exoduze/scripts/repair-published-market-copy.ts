import { closeDatabase, createDatabase } from "../src/db/database.js";
import { queryOne, queryRows } from "../src/db/query.js";
import { slugify } from "../src/lib/ids.js";
import { env } from "../src/config/env.js";
import {
  buildTopicNewsContext,
  type TopicNewsCandidate,
} from "../src/modules/markets/market-generator.js";
import { MarketDetailGenerator } from "../src/modules/markets/market-detail-generator.js";

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
};

const db = createDatabase(env);
const generator = new MarketDetailGenerator(env);
const marketIds = process.argv
  .slice(2)
  .map((value) => value.trim())
  .filter(Boolean);

if (marketIds.length === 0) {
  console.error("Provide at least one market id to repair.");
  process.exit(1);
}

try {
  const repaired = [];

  for (const marketId of marketIds) {
    const market = await queryOne<MarketRow>(
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
          COALESCE(m.cutoff_at, m.decision_cutoff_at)::text AS cutoff_at
        FROM markets m
        JOIN categories c ON c.id = m.category_id
        JOIN market_topics mt ON mt.market_id = m.id AND mt.is_primary = true
        JOIN topics t ON t.id = mt.topic_id
        WHERE m.id = $1
        LIMIT 1
      `,
      [marketId],
    );

    if (!market) {
      continue;
    }

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
          nit.relevance_score,
          nit.is_primary
        FROM topics t
        JOIN categories c ON c.id = t.category_id
        JOIN news_item_topics nit ON nit.topic_id = t.id
        JOIN news_items ni ON ni.id = nit.news_item_id
        JOIN news_sources ns ON ns.id = ni.source_id
        WHERE c.slug = $1
          AND t.slug = $2
          AND t.is_active = true
        ORDER BY ni.is_breaking DESC, nit.is_primary DESC, nit.relevance_score DESC, ni.published_at DESC
        LIMIT 15
      `,
      [market.category_slug, market.topic_slug],
    );

    const news = buildTopicNewsContext(newsRows, {
      name: market.topic_name,
      slug: market.topic_slug,
    });

    const generated = await generator.generate({
      topicName: market.topic_name,
      categoryName: market.category_name,
      requiredRank: Number(market.required_rank),
      cutoffAt: market.cutoff_at,
      news,
    });

    const desiredSlug = slugify(generated.copy.title) || market.slug;
    const slugConflict = await queryOne<{ id: string }>(
      db,
      `
        SELECT id
        FROM markets
        WHERE slug = $1 AND id <> $2
        LIMIT 1
      `,
      [desiredSlug, market.id],
    );
    const nextSlug = slugConflict ? market.slug : desiredSlug;

    await db.query(
      `
        UPDATE markets
        SET
          slug = $2,
          title = $3,
          short_description = $4,
          description = $5,
          rules_json = $6::jsonb,
          context_json = COALESCE(context_json, '{}'::jsonb) || $7::jsonb,
          updated_at = now()
        WHERE id = $1
      `,
      [
        market.id,
        nextSlug,
        generated.copy.title,
        generated.copy.shortDescription,
        generated.copy.description,
        JSON.stringify(generated.copy.resolutionCriteria),
        JSON.stringify({
          news_hook: generated.copy.newsHook,
          copy_provider: generated.provider,
          copy_model: generated.model,
          used_copy_fallback: generated.usedFallback,
          linked_news: news.map((item) => ({
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

    repaired.push({
      id: market.id,
      previous_title: market.title,
      new_title: generated.copy.title,
      previous_slug: market.slug,
      new_slug: nextSlug,
      copy_provider: generated.provider,
      used_copy_fallback: generated.usedFallback,
    });
  }

  console.log(JSON.stringify({ repaired }, null, 2));
} finally {
  await closeDatabase(db);
}
