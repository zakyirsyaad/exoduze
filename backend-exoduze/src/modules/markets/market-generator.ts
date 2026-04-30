import type { Env } from "../../config/env.js";
import type { PoolClient, QueryResultRow } from "pg";

import type { AppDatabase } from "../../db/database.js";
import { queryOne, queryRows } from "../../db/query.js";
import {
  createStableId,
  MAX_MARKET_SLUG_LENGTH,
  slugify,
} from "../../lib/ids.js";
import { HttpError } from "../../lib/http-error.js";
import { buildConfiguredJoinDeadlineAt } from "./market-join-window.js";
import {
  buildFallbackMarketCopy,
  MarketDetailGenerator,
  type TopicNewsContextItem,
} from "./market-detail-generator.js";
import type {
  SnapshotTopic,
  TopicSnapshotRecord,
} from "../topics/topic-snapshots.js";

type Queryable = AppDatabase | PoolClient;

export type MarketCreatedBy = "ai_generator" | "admin" | "system";

export type MarketDraft = {
  slug: string;
  title: string;
  shortDescription: string;
  description: string;
  resolutionCriteria: string[];
  category: string;
  topic: SnapshotTopic;
  cutoffAt: string;
  opensAt: string;
  requiredRank: number;
  resolutionSource: "topic_snapshots";
  createdBy: MarketCreatedBy;
  generatedReason: string;
  newsContext: TopicNewsContextItem[];
  newsHook: string | null;
  copyProvider: "openai" | "fallback";
  copyModel: string;
  usedCopyFallback: boolean;
};

export type GenerateMarketDraftsInput = {
  category: string;
  topics: SnapshotTopic[];
  opensAt?: string | undefined;
  requiredRank?: number | undefined;
  createdBy?: MarketCreatedBy | undefined;
  generatedReason?: string | undefined;
  existingSlugs?: Set<string> | undefined;
  minConfidence?: number | undefined;
  maxMarkets?: number | undefined;
  newsByTopicSlug?: ReadonlyMap<string, TopicNewsContextItem[]> | undefined;
};

export type CreateMarketsFromSnapshotInput = {
  snapshot: TopicSnapshotRecord;
  opensAt?: string | undefined;
  requiredRank?: number | undefined;
  createdBy?: MarketCreatedBy | undefined;
  generatedReason?: string | undefined;
  maxMarkets?: number | undefined;
  minConfidence?: number | undefined;
  skipIfActiveMarketExists?: boolean | undefined;
};

export type CreatedSnapshotMarket = {
  id: string;
  slug: string;
  title: string;
};

export type SkippedSnapshotMarketReason =
  | "topic_ineligible"
  | "missing_linked_news"
  | "empty_generated_slug"
  | "duplicate_batch_slug"
  | "existing_slug"
  | "active_market_exists"
  | "duplicate_market";

export type SkippedSnapshotMarket = {
  topicSlug: string;
  topicName: string;
  reason: SkippedSnapshotMarketReason;
  detail?: string | null | undefined;
};

export type CreateMarketsFromSnapshotResult = {
  marketsCreated: number;
  skipped: number;
  markets: CreatedSnapshotMarket[];
  skippedTopics: SkippedSnapshotMarket[];
};

type CategoryRow = QueryResultRow & {
  id: string;
  slug: string;
  name: string;
};

type TopicRow = QueryResultRow & {
  id: string;
  slug: string;
  name: string;
};

type ExistingSlugRow = QueryResultRow & {
  slug: string;
};

export type TopicNewsCandidate = {
  id: string;
  title: string;
  summary: string | null;
  url: string;
  source_name: string;
  published_at: string;
  is_breaking: boolean;
  relevance_score: number | string;
  is_primary: boolean;
};

type TopicNewsRow = QueryResultRow & TopicNewsCandidate;

type TopicKeywordRef = {
  name: string;
  slug: string;
};

const DEFAULT_REQUIRED_RANK = 3;
const DEFAULT_MIN_CONFIDENCE = 0.35;
const DEFAULT_MAX_MARKETS = 3;
export const AUTOMATIC_MARKET_DURATION_HOURS = 24;
const AUTOMATIC_MARKET_DURATION_MS =
  AUTOMATIC_MARKET_DURATION_HOURS * 60 * 60_000;

export class MarketGeneratorService {
  private readonly marketDetailGenerator: MarketDetailGenerator;

  constructor(
    private readonly db: AppDatabase,
    private readonly env: Env,
  ) {
    this.marketDetailGenerator = new MarketDetailGenerator(env);
  }

  async createMarketsFromSnapshot(
    input: CreateMarketsFromSnapshotInput,
  ): Promise<CreateMarketsFromSnapshotResult> {
    const categorySlug = normalizeSlug(input.snapshot.category, "category");
    const categoryLabel = toTitleLabel(categorySlug);
    const opensAt = normalizeIsoDate(input.opensAt ?? new Date().toISOString());
    const cutoffAt = buildAutomaticCutoffAt(opensAt);
    const requiredRank = input.requiredRank ?? DEFAULT_REQUIRED_RANK;
    if (!Number.isInteger(requiredRank) || requiredRank < 1) {
      throw new HttpError(
        400,
        "INVALID_REQUIRED_RANK",
        "required_rank must be greater than or equal to 1.",
      );
    }

    const maxMarkets = input.maxMarkets ?? DEFAULT_MAX_MARKETS;
    const minConfidence = input.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
    const generatedReason =
      input.generatedReason ??
      `Generated from topic snapshot ${input.snapshot.id}.`;
    const drafts: MarketDraft[] = [];
    const batchSlugs = new Set<string>();
    const skippedTopics: SkippedSnapshotMarket[] = [];

    for (const topic of input.snapshot.topics) {
      if (drafts.length >= maxMarkets) {
        break;
      }

      if (!isTopicEligible(topic, minConfidence)) {
        skippedTopics.push({
          topicSlug: topic.slug,
          topicName: topic.name,
          reason: "topic_ineligible",
        });
        continue;
      }

      const newsContext = await this.getTopicNewsContext(categorySlug, topic);
      if (newsContext.length === 0) {
        skippedTopics.push({
          topicSlug: topic.slug,
          topicName: topic.name,
          reason: "missing_linked_news",
        });
        continue;
      }

      const generatedCopy = await this.marketDetailGenerator.generate({
        topicName: topic.name,
        categoryName: categoryLabel,
        requiredRank,
        cutoffAt,
        news: newsContext,
      });
      const slug = slugify(generatedCopy.copy.title, {
        maxLength: MAX_MARKET_SLUG_LENGTH,
      });
      if (!slug) {
        skippedTopics.push({
          topicSlug: topic.slug,
          topicName: topic.name,
          reason: "empty_generated_slug",
          detail: generatedCopy.copy.title,
        });
        continue;
      }

      if (batchSlugs.has(slug)) {
        skippedTopics.push({
          topicSlug: topic.slug,
          topicName: topic.name,
          reason: "duplicate_batch_slug",
          detail: slug,
        });
        continue;
      }

      drafts.push({
        slug,
        title: generatedCopy.copy.title,
        shortDescription: generatedCopy.copy.shortDescription,
        description: generatedCopy.copy.description,
        resolutionCriteria: generatedCopy.copy.resolutionCriteria,
        category: categorySlug,
        topic,
        cutoffAt,
        opensAt,
        requiredRank,
        resolutionSource: "topic_snapshots",
        createdBy: input.createdBy ?? "ai_generator",
        generatedReason,
        newsContext,
        newsHook: generatedCopy.copy.newsHook,
        copyProvider: generatedCopy.provider,
        copyModel: generatedCopy.model,
        usedCopyFallback: generatedCopy.usedFallback,
      });
      batchSlugs.add(slug);
    }

    if (drafts.length === 0) {
      return {
        marketsCreated: 0,
        skipped: skippedTopics.length,
        markets: [],
        skippedTopics,
      };
    }

    const client = await this.db.connect();
    try {
      await client.query("BEGIN");

      const category = await this.ensureCategory(
        drafts[0]?.category ?? input.snapshot.category,
        client,
      );
      const existingSlugs = await this.getExistingSlugs(client);
      const created: CreatedSnapshotMarket[] = [];

      for (const draft of drafts) {
        if (existingSlugs.has(draft.slug)) {
          skippedTopics.push({
            topicSlug: draft.topic.slug,
            topicName: draft.topic.name,
            reason: "existing_slug",
            detail: draft.slug,
          });
          continue;
        }

        const topic = await this.ensureTopic(category, draft.topic, client);
        if (input.skipIfActiveMarketExists) {
          const activeMarket = await this.findActiveTopicMarket(
            category.id,
            topic.id,
            client,
          );
          if (activeMarket) {
            skippedTopics.push({
              topicSlug: draft.topic.slug,
              topicName: draft.topic.name,
              reason: "active_market_exists",
              detail: activeMarket.slug,
            });
            existingSlugs.add(activeMarket.slug);
            continue;
          }
        }

        const duplicate = await this.findDuplicateMarket(
          category.id,
          topic.id,
          draft.cutoffAt,
          client,
        );
        if (duplicate) {
          skippedTopics.push({
            topicSlug: draft.topic.slug,
            topicName: draft.topic.name,
            reason: "duplicate_market",
            detail: duplicate.slug,
          });
          existingSlugs.add(duplicate.slug);
          continue;
        }

        const marketId = createStableId("mkt", draft.slug);
        const joinDeadlineAt = buildConfiguredJoinDeadlineAt({
          opensAt: draft.opensAt,
          decisionCutoffAt: draft.cutoffAt,
          closesAt: draft.cutoffAt,
          resolvesAt: null,
          config: {
            joinWindowRatio: this.env.MARKET_DEFAULT_JOIN_WINDOW_RATIO,
            minJoinWindowHours: this.env.MARKET_DEFAULT_MIN_JOIN_WINDOW_HOURS,
            maxJoinWindowHours: this.env.MARKET_DEFAULT_MAX_JOIN_WINDOW_HOURS,
          },
        });

        const insertResult = await client.query(
          `
            INSERT INTO markets (
              id,
              slug,
              title,
              short_description,
              description,
              category_id,
              status,
              oracle_source,
              settlement_asset,
              opens_at,
              join_deadline_at,
              decision_cutoff_at,
              cutoff_at,
              closes_at,
              resolves_at,
              total_liquidity_usdc,
              final_liquidity_usdc,
              outcome_type,
              resolution_source,
              required_rank,
              created_by,
              generated_reason,
              rules_json,
              context_json,
              created_at,
              updated_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6, 'open', 'exoduze_topic_snapshots',
              'USDC', $7, $8, $9, $9, $9, NULL, '0', NULL,
              'YES_NO', 'topic_snapshots', $10, $11, $12, $13::jsonb,
              $14::jsonb, now(), now()
            )
            ON CONFLICT (slug) DO NOTHING
            RETURNING id
          `,
          [
            marketId,
            draft.slug,
            draft.title,
            draft.shortDescription,
            draft.description,
            category.id,
            draft.opensAt,
            joinDeadlineAt,
            draft.cutoffAt,
            draft.requiredRank,
            draft.createdBy,
            draft.generatedReason,
            JSON.stringify(draft.resolutionCriteria),
            JSON.stringify({
              resolution_source: draft.resolutionSource,
              category: category.slug,
              topic: topic.slug,
              cutoff_at: draft.cutoffAt,
              required_rank: draft.requiredRank,
              snapshot_id: input.snapshot.id,
              generated_reason: draft.generatedReason,
              news_hook: draft.newsHook,
              copy_provider: draft.copyProvider,
              copy_model: draft.copyModel,
              used_copy_fallback: draft.usedCopyFallback,
              linked_news: draft.newsContext.map((item) => ({
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

        if (Number(insertResult.rowCount ?? 0) === 0) {
          skippedTopics.push({
            topicSlug: draft.topic.slug,
            topicName: draft.topic.name,
            reason: "existing_slug",
            detail: draft.slug,
          });
          existingSlugs.add(draft.slug);
          continue;
        }

        await client.query(
          `
            INSERT INTO market_topics (id, market_id, topic_id, is_primary, created_at, updated_at)
            VALUES ($1, $2, $3, true, now(), now())
            ON CONFLICT (market_id, topic_id) DO NOTHING
          `,
          [createStableId("mt", `${marketId}:${topic.id}`), marketId, topic.id],
        );
        await this.linkMarketNews(marketId, draft.newsContext, client);

        created.push({
          id: marketId,
          slug: draft.slug,
          title: draft.title,
        });
        existingSlugs.add(draft.slug);
      }

      await client.query("COMMIT");

      return {
        marketsCreated: created.length,
        skipped: skippedTopics.length,
        markets: created,
        skippedTopics,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async ensureCategory(categorySlug: string, db: Queryable) {
    const normalizedSlug = normalizeSlug(categorySlug, "category");
    const existing = await queryOne<CategoryRow>(
      db,
      `
        SELECT id, slug, name
        FROM categories
        WHERE slug = $1
        LIMIT 1
      `,
      [normalizedSlug],
    );

    if (existing) {
      return existing;
    }

    const id = createStableId("cat", normalizedSlug);
    const name = toTitleLabel(normalizedSlug);
    await db.query(
      `
        INSERT INTO categories (id, slug, name, description, sort_order, is_active, created_at, updated_at)
        VALUES ($1, $2, $3, $4, 0, true, now(), now())
        ON CONFLICT (slug) DO NOTHING
      `,
      [id, normalizedSlug, name, `${name} prediction market category.`],
    );

    return {
      id,
      slug: normalizedSlug,
      name,
    };
  }

  private async ensureTopic(
    category: CategoryRow,
    topic: SnapshotTopic,
    db: Queryable,
  ) {
    const existing = await queryOne<TopicRow>(
      db,
      `
        SELECT id, slug, name
        FROM topics
        WHERE category_id = $1 AND slug = $2
        LIMIT 1
      `,
      [category.id, topic.slug],
    );

    if (existing) {
      return existing;
    }

    const id = createStableId("topic", `${category.slug}:${topic.slug}`);
    await db.query(
      `
        INSERT INTO topics (id, category_id, slug, name, description, is_active, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, true, now(), now())
        ON CONFLICT (category_id, slug) DO NOTHING
      `,
      [
        id,
        category.id,
        topic.slug,
        topic.name,
        `${topic.name} topic generated from a stored Exoduze snapshot.`,
      ],
    );

    return {
      id,
      slug: topic.slug,
      name: topic.name,
    };
  }

  private async getExistingSlugs(db: Queryable) {
    const rows = await queryRows<ExistingSlugRow>(
      db,
      "SELECT slug FROM markets",
    );

    return new Set(rows.map((row) => row.slug));
  }

  private async findDuplicateMarket(
    categoryId: string,
    topicId: string,
    cutoffAt: string,
    db: Queryable,
  ) {
    return queryOne<ExistingSlugRow>(
      db,
      `
        SELECT m.slug
        FROM markets m
        JOIN market_topics mt ON mt.market_id = m.id
        WHERE m.category_id = $1
          AND mt.topic_id = $2
          AND COALESCE(m.cutoff_at, m.decision_cutoff_at) = $3::timestamptz
          AND m.status <> 'cancelled'
        LIMIT 1
      `,
      [categoryId, topicId, cutoffAt],
    );
  }

  private async findActiveTopicMarket(
    categoryId: string,
    topicId: string,
    db: Queryable,
  ) {
    return queryOne<ExistingSlugRow>(
      db,
      `
        SELECT m.slug
        FROM markets m
        JOIN market_topics mt ON mt.market_id = m.id
        WHERE m.category_id = $1
          AND mt.topic_id = $2
          AND mt.is_primary = true
          AND COALESCE(m.resolution_source, '') = 'topic_snapshots'
          AND m.final_outcome IS NULL
          AND m.status NOT IN ('draft', 'resolved', 'cancelled')
        LIMIT 1
      `,
      [categoryId, topicId],
    );
  }

  private async getTopicNewsContext(
    categorySlug: string,
    topic: SnapshotTopic,
  ) {
    const rows = await queryRows<TopicNewsRow>(
      this.db,
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
      [categorySlug, topic.slug],
    );

    return buildTopicNewsContext(rows, topic);
  }

  private async linkMarketNews(
    marketId: string,
    newsContext: TopicNewsContextItem[],
    db: Queryable,
  ) {
    for (const newsItem of newsContext) {
      await db.query(
        `
          INSERT INTO news_item_markets (
            id, news_item_id, market_id, relevance_score, created_at
          ) VALUES ($1, $2, $3, $4, now())
          ON CONFLICT (news_item_id, market_id) DO NOTHING
        `,
        [
          createStableId("nim", `${newsItem.id}:${marketId}`),
          newsItem.id,
          marketId,
          newsItem.relevanceScore,
        ],
      );
    }
  }
}

export function generateMarketDrafts(input: GenerateMarketDraftsInput) {
  const categorySlug = normalizeSlug(input.category, "category");
  const categoryLabel = toTitleLabel(categorySlug);
  const opensAt = normalizeIsoDate(input.opensAt ?? new Date().toISOString());
  const cutoffAt = buildAutomaticCutoffAt(opensAt);
  const requiredRank = input.requiredRank ?? DEFAULT_REQUIRED_RANK;
  if (!Number.isInteger(requiredRank) || requiredRank < 1) {
    throw new HttpError(
      400,
      "INVALID_REQUIRED_RANK",
      "required_rank must be greater than or equal to 1.",
    );
  }

  const maxMarkets = input.maxMarkets ?? DEFAULT_MAX_MARKETS;
  const minConfidence = input.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const existingSlugs = input.existingSlugs ?? new Set<string>();
  const drafts: MarketDraft[] = [];

  for (const topic of input.topics) {
    if (drafts.length >= maxMarkets) {
      break;
    }

    if (!isTopicEligible(topic, minConfidence)) {
      continue;
    }

    const newsContext = input.newsByTopicSlug?.get(topic.slug) ?? [];
    const copy = buildFallbackMarketCopy({
      topicName: topic.name,
      categoryName: categoryLabel,
      requiredRank,
      cutoffAt,
      news: newsContext,
    });
    const slug = slugify(copy.title, {
      maxLength: MAX_MARKET_SLUG_LENGTH,
    });
    if (!slug || existingSlugs.has(slug)) {
      continue;
    }

    drafts.push({
      slug,
      title: copy.title,
      shortDescription: copy.shortDescription,
      description: copy.description,
      resolutionCriteria: copy.resolutionCriteria,
      category: categorySlug,
      topic,
      cutoffAt,
      opensAt,
      requiredRank,
      resolutionSource: "topic_snapshots",
      createdBy: input.createdBy ?? "ai_generator",
      generatedReason:
        input.generatedReason ??
        "Generated from Exoduze hot-topic snapshot metadata.",
      newsContext,
      newsHook: copy.newsHook,
      copyProvider: "fallback",
      copyModel: "market-copy-fallback-v1",
      usedCopyFallback: true,
    });
    existingSlugs.add(slug);
  }

  return drafts;
}

export function buildMarketTitle({
  topicName,
  categoryName,
  requiredRank,
  cutoffAt,
  newsContext,
}: {
  topicName: string;
  categoryName: string;
  requiredRank: number;
  cutoffAt: string;
  newsContext?: TopicNewsContextItem[] | undefined;
}) {
  return buildFallbackMarketCopy({
    topicName,
    categoryName,
    requiredRank,
    cutoffAt,
    news: newsContext ?? [],
  }).title;
}

export function buildMarketHeadline({
  topicName,
  categoryName,
  requiredRank,
  cutoffAt,
  newsContext,
}: {
  topicName: string;
  categoryName: string;
  requiredRank: number;
  cutoffAt: string;
  newsContext?: TopicNewsContextItem[] | undefined;
}) {
  return buildFallbackMarketCopy({
    topicName,
    categoryName,
    requiredRank,
    cutoffAt,
    news: newsContext ?? [],
  }).shortDescription;
}

export function buildResolutionDescription({
  topicName,
  categoryName,
  requiredRank,
  cutoffAt,
  newsContext,
}: {
  topicName: string;
  categoryName: string;
  requiredRank: number;
  cutoffAt: string;
  newsContext?: TopicNewsContextItem[] | undefined;
}) {
  return buildFallbackMarketCopy({
    topicName,
    categoryName,
    requiredRank,
    cutoffAt,
    news: newsContext ?? [],
  }).description;
}

export function buildAutomaticCutoffAt(opensAt: string) {
  const opensAtMs = Date.parse(opensAt);
  if (Number.isNaN(opensAtMs)) {
    throw new HttpError(
      400,
      "INVALID_TIMESTAMP",
      "Timestamps must be valid ISO dates.",
    );
  }

  return new Date(opensAtMs + AUTOMATIC_MARKET_DURATION_MS).toISOString();
}

function normalizeSlug(value: string, label: string) {
  const normalized = slugify(value);
  if (!normalized) {
    throw new HttpError(
      400,
      `INVALID_${label.toUpperCase()}`,
      `${label} must not be empty.`,
    );
  }

  return normalized;
}

function normalizeIsoDate(value: string) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new HttpError(
      400,
      "INVALID_TIMESTAMP",
      "Timestamps must be valid ISO dates.",
    );
  }

  return new Date(parsed).toISOString();
}

function toTitleLabel(slug: string) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function isTopicEligible(topic: SnapshotTopic, minConfidence: number) {
  if (!topic.name.trim() || !topic.slug) {
    return false;
  }

  if (
    typeof topic.confidence === "number" &&
    Number.isFinite(topic.confidence) &&
    topic.confidence < minConfidence
  ) {
    return false;
  }

  return true;
}

function toFiniteNumber(value: number | string | null | undefined) {
  const numberValue = Number(value ?? 0);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

export function buildTopicNewsContext(
  rows: readonly TopicNewsCandidate[],
  topic: TopicKeywordRef,
) {
  const filteredRows = selectTopicNewsRows(rows, topic);
  const selectedRows = filteredRows.length > 0 ? filteredRows : rows;

  return selectedRows.slice(0, 6).map((row) => ({
    id: row.id,
    title: row.title,
    summary: row.summary,
    url: row.url,
    sourceName: row.source_name,
    publishedAt: row.published_at,
    isBreaking: Boolean(row.is_breaking),
    relevanceScore: toFiniteNumber(row.relevance_score),
  }));
}

export function selectTopicNewsRows<
  T extends Pick<TopicNewsCandidate, "title" | "summary">,
>(rows: readonly T[], topic: TopicKeywordRef) {
  return rows.filter((row) => isNewsRelevantToTopic(row, topic));
}

function isNewsRelevantToTopic(
  row: Pick<TopicNewsCandidate, "title" | "summary">,
  topic: TopicKeywordRef,
) {
  const haystacks = [row.title, row.summary ?? ""]
    .map((value) => normalizeSearchText(value))
    .filter(Boolean);
  if (haystacks.length === 0) {
    return false;
  }

  const keywords = buildTopicKeywords(topic);
  return keywords.some((keyword) => {
    return haystacks.some((haystack) => {
      if (keyword.includes(" ")) {
        return haystack.includes(keyword);
      }

      return new RegExp(`\\b${escapeRegex(keyword)}\\b`, "i").test(haystack);
    });
  });
}

function buildTopicKeywords(topic: TopicKeywordRef) {
  const fullKeywords = [topic.name, topic.slug.replace(/-/g, " ")]
    .map((value) => normalizeSearchText(value))
    .filter((value) => value.length >= 2);
  const tokenKeywords = [...topic.name.split(/\s+/), ...topic.slug.split("-")]
    .map((value) => normalizeSearchText(value))
    .filter((value) => value.length >= 3);

  return [...new Set([...fullKeywords, ...tokenKeywords])];
}

function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
