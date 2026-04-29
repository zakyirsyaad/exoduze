import type { Env } from "../../config/env.js";
import type { PoolClient, QueryResultRow } from "pg";

import type { AppDatabase } from "../../db/database.js";
import { queryOne, queryRows } from "../../db/query.js";
import { createStableId, slugify } from "../../lib/ids.js";
import { HttpError } from "../../lib/http-error.js";
import { buildConfiguredJoinDeadlineAt } from "./market-join-window.js";
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
  category: string;
  topic: SnapshotTopic;
  cutoffAt: string;
  opensAt: string;
  requiredRank: number;
  resolutionSource: "topic_snapshots";
  createdBy: MarketCreatedBy;
  generatedReason: string;
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

const DEFAULT_REQUIRED_RANK = 3;
const DEFAULT_MIN_CONFIDENCE = 0.35;
const DEFAULT_MAX_MARKETS = 3;
export const AUTOMATIC_MARKET_DURATION_HOURS = 24;
const AUTOMATIC_MARKET_DURATION_MS =
  AUTOMATIC_MARKET_DURATION_HOURS * 60 * 60_000;

export class MarketGeneratorService {
  constructor(
    private readonly db: AppDatabase,
    private readonly env: Env,
  ) {}

  async createMarketsFromSnapshot(input: CreateMarketsFromSnapshotInput) {
    const drafts = generateMarketDrafts({
      category: input.snapshot.category,
      topics: input.snapshot.topics,
      opensAt: input.opensAt,
      requiredRank: input.requiredRank,
      createdBy: input.createdBy ?? "ai_generator",
      generatedReason:
        input.generatedReason ??
        `Generated from topic snapshot ${input.snapshot.id}.`,
      minConfidence: input.minConfidence,
      maxMarkets: input.maxMarkets,
    });

    if (drafts.length === 0) {
      return {
        marketsCreated: 0,
        skipped: input.snapshot.topics.length,
        markets: [],
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
      const created = [];
      let skipped = 0;

      for (const draft of drafts) {
        if (existingSlugs.has(draft.slug)) {
          skipped += 1;
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
            skipped += 1;
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
          skipped += 1;
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
            JSON.stringify([draft.description]),
            JSON.stringify({
              resolution_source: draft.resolutionSource,
              category: category.slug,
              topic: topic.slug,
              cutoff_at: draft.cutoffAt,
              required_rank: draft.requiredRank,
              snapshot_id: input.snapshot.id,
              generated_reason: draft.generatedReason,
            }),
          ],
        );

        if (Number(insertResult.rowCount ?? 0) === 0) {
          skipped += 1;
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
        skipped,
        markets: created,
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

    if (!topic.name.trim() || !topic.slug) {
      continue;
    }

    if (
      typeof topic.confidence === "number" &&
      Number.isFinite(topic.confidence) &&
      topic.confidence < minConfidence
    ) {
      continue;
    }

    const title = buildMarketTitle({
      topicName: topic.name,
      categoryName: categoryLabel,
      requiredRank,
      cutoffAt,
    });
    const slug = slugify(title);
    if (!slug || existingSlugs.has(slug)) {
      continue;
    }

    drafts.push({
      slug,
      title,
      shortDescription: buildMarketHeadline({
        topicName: topic.name,
        categoryName: categoryLabel,
        requiredRank,
        cutoffAt,
      }),
      description: buildResolutionDescription({
        topicName: topic.name,
        categoryName: categoryLabel,
        requiredRank,
        cutoffAt,
      }),
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
}: {
  topicName: string;
  categoryName: string;
  requiredRank: number;
  cutoffAt: string;
}) {
  return `Will ${topicName} remain a top ${requiredRank} ${categoryName} topic through ${formatUtcTitleTime(cutoffAt)}?`;
}

export function buildMarketHeadline({
  topicName,
  categoryName,
  requiredRank,
  cutoffAt,
}: {
  topicName: string;
  categoryName: string;
  requiredRank: number;
  cutoffAt: string;
}) {
  const cutoffLabel = formatUtcTitleTime(cutoffAt);

  return `AI agents compete to predict whether ${topicName} will stay in Exoduze's top ${requiredRank} ${categoryName} topics through ${cutoffLabel}.`;
}

export function buildResolutionDescription({
  topicName,
  categoryName,
  requiredRank,
  cutoffAt,
}: {
  topicName: string;
  categoryName: string;
  requiredRank: number;
  cutoffAt: string;
}) {
  const cutoffLabel = formatUtcTitleTime(cutoffAt);

  return `This AI market asks whether ${topicName} can hold a top ${requiredRank} position in Exoduze's ${categoryName} hot-topic rankings through ${cutoffLabel}. It resolves YES if ${topicName} appears within the top ${requiredRank} of the first valid Exoduze 24-hour topic snapshot generated after ${cutoffLabel}. It resolves NO if the topic ranks below #${requiredRank} or does not appear in that snapshot.`;
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

function formatUtcTitleTime(value: string) {
  const date = new Date(value);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes} UTC`;
}
