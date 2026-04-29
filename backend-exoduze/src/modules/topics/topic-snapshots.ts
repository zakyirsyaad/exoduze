import type { PoolClient, QueryResultRow } from "pg";

import type { AppDatabase } from "../../db/database.js";
import { queryOne, queryRows } from "../../db/query.js";
import { createStableId, slugify } from "../../lib/ids.js";
import { HttpError } from "../../lib/http-error.js";

type Queryable = AppDatabase | PoolClient;

export type SnapshotTopicInput = {
  rank: number;
  name: string;
  slug?: string | undefined;
  score: number;
  confidence?: number | undefined;
  sources?: string[] | undefined;
};

export type SnapshotTopic = {
  rank: number;
  name: string;
  slug: string;
  score: number;
  confidence?: number | undefined;
  sources?: string[] | undefined;
};

export type TopicSnapshotRecord = {
  id: string;
  category: string;
  generated_at: string;
  window_hours: number;
  source_count: number;
  topics: SnapshotTopic[];
  raw_payload: unknown | null;
  created_at: string;
};

type TopicSnapshotRow = QueryResultRow & {
  id: string;
  category: string;
  generated_at: string;
  window_hours: number | string;
  source_count: number | string;
  topics: unknown;
  raw_payload: unknown | null;
  created_at: string;
};

type HotTopicRow = QueryResultRow & {
  rank: number | string;
  name: string;
  slug: string;
  score: number | string;
  unique_sources_count: number | string;
  window_end: string;
};

export type SaveTopicSnapshotInput = {
  category: string;
  generatedAt?: string | undefined;
  windowHours?: number | undefined;
  sourceCount?: number | undefined;
  topics: SnapshotTopicInput[];
  rawPayload?: unknown;
};

export type SnapshotLookupInput = {
  category: string;
  cutoffAt: string;
  windowHours?: number | undefined;
};

const DEFAULT_WINDOW_HOURS = 24;
const DEV_FINANCE_TOPICS: SnapshotTopicInput[] = [
  { rank: 1, name: "Rates", slug: "rates", score: 95, confidence: 0.92 },
  { rank: 2, name: "Stocks", slug: "stocks", score: 88, confidence: 0.9 },
  { rank: 3, name: "Oil", slug: "oil", score: 76, confidence: 0.82 },
  { rank: 4, name: "Crypto", slug: "crypto", score: 64, confidence: 0.74 },
  { rank: 5, name: "Earnings", slug: "earnings", score: 58, confidence: 0.71 },
];

export class TopicSnapshotsService {
  constructor(private readonly db: AppDatabase) {}

  async saveSnapshot(input: SaveTopicSnapshotInput, db: Queryable = this.db) {
    const category = normalizeRequiredSlug(input.category, "category");
    const generatedAt = normalizeIsoDate(
      input.generatedAt ?? new Date().toISOString(),
      "generated_at",
    );
    const windowHours = input.windowHours ?? DEFAULT_WINDOW_HOURS;
    if (!Number.isInteger(windowHours) || windowHours < 1) {
      throw new HttpError(
        400,
        "INVALID_SNAPSHOT_WINDOW",
        "window_hours must be a positive integer.",
      );
    }

    const topics = normalizeSnapshotTopics(input.topics);
    const sourceCount = input.sourceCount ?? inferSourceCount(topics);
    if (!Number.isInteger(sourceCount) || sourceCount < 0) {
      throw new HttpError(
        400,
        "INVALID_SNAPSHOT_SOURCE_COUNT",
        "source_count must be a non-negative integer.",
      );
    }

    const id = createStableId(
      "tsnap",
      `${category}:${generatedAt}:${windowHours}`,
    );

    await db.query(
      `
        INSERT INTO topic_snapshots (
          id, category, generated_at, window_hours, source_count, topics, raw_payload, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, now())
        ON CONFLICT (category, generated_at, window_hours)
        DO UPDATE SET
          source_count = excluded.source_count,
          topics = excluded.topics,
          raw_payload = excluded.raw_payload
      `,
      [
        id,
        category,
        generatedAt,
        windowHours,
        sourceCount,
        JSON.stringify(topics),
        input.rawPayload === undefined ? null : JSON.stringify(input.rawPayload),
      ],
    );

    return this.getSnapshotById(id, db);
  }

  async saveLatestHotTopicSnapshot(category: string, limit = 10) {
    const categorySlug = normalizeRequiredSlug(category, "category");
    const rows = await queryRows<HotTopicRow>(
      this.db,
      `
        WITH latest AS (
          SELECT hts.category_id, MAX(hts.window_end) AS window_end
          FROM hot_topic_snapshots hts
          JOIN categories c ON c.id = hts.category_id
          WHERE c.slug = $1 AND hts.window_type = '24h'
          GROUP BY hts.category_id
        )
        SELECT
          hts.rank,
          t.name,
          t.slug,
          hts.heat_score AS score,
          hts.unique_sources_count,
          hts.window_end::text
        FROM latest
        JOIN hot_topic_snapshots hts
          ON hts.category_id = latest.category_id
          AND hts.window_end = latest.window_end
          AND hts.window_type = '24h'
        JOIN topics t ON t.id = hts.topic_id
        ORDER BY hts.rank ASC
        LIMIT $2
      `,
      [categorySlug, limit],
    );

    if (rows.length === 0) {
      throw new HttpError(
        404,
        "HOT_TOPICS_NOT_FOUND",
        `No 24h hot topics were found for category '${categorySlug}'.`,
      );
    }

    return this.saveSnapshot({
      category: categorySlug,
      generatedAt: rows[0]?.window_end,
      windowHours: DEFAULT_WINDOW_HOURS,
      sourceCount: rows.reduce(
        (total, row) => total + toFiniteInteger(row.unique_sources_count),
        0,
      ),
      topics: rows.map((row) => ({
        rank: toFiniteInteger(row.rank),
        name: row.name,
        slug: row.slug,
        score: toFiniteNumber(row.score),
      })),
      rawPayload: {
        source: "hot_topic_snapshots",
        category: categorySlug,
      },
    });
  }

  async saveDevFinanceSnapshot(generatedAt = new Date().toISOString()) {
    return this.saveSnapshot({
      category: "finance",
      generatedAt,
      windowHours: DEFAULT_WINDOW_HOURS,
      sourceCount: DEV_FINANCE_TOPICS.length,
      topics: DEV_FINANCE_TOPICS,
      rawPayload: {
        source: "dev_seed",
        note: "Deterministic local Finance snapshot for oracle flow testing.",
      },
    });
  }

  async getSnapshotById(id: string, db: Queryable = this.db) {
    const row = await queryOne<TopicSnapshotRow>(
      db,
      `
        SELECT
          id,
          category,
          generated_at::text,
          window_hours,
          source_count,
          topics,
          raw_payload,
          created_at::text
        FROM topic_snapshots
        WHERE id = $1
        LIMIT 1
      `,
      [id],
    );

    return row ? mapSnapshotRow(row) : null;
  }

  async getFirstValidSnapshotAfter(input: SnapshotLookupInput) {
    const category = normalizeRequiredSlug(input.category, "category");
    const cutoffAt = normalizeIsoDate(input.cutoffAt, "cutoff_at");
    const windowHours = input.windowHours ?? DEFAULT_WINDOW_HOURS;

    const rows = await queryRows<TopicSnapshotRow>(
      this.db,
      `
        SELECT
          id,
          category,
          generated_at::text,
          window_hours,
          source_count,
          topics,
          raw_payload,
          created_at::text
        FROM topic_snapshots
        WHERE category = $1
          AND generated_at > $2::timestamptz
          AND window_hours = $3
          AND jsonb_array_length(topics) > 0
        ORDER BY generated_at ASC
        LIMIT 5
      `,
      [category, cutoffAt, windowHours],
    );

    for (const row of rows) {
      const snapshot = mapSnapshotRow(row);
      if (snapshot.topics.length > 0) {
        return snapshot;
      }
    }

    return null;
  }

  async getLatestSnapshotByCategory(category: string, windowHours = DEFAULT_WINDOW_HOURS) {
    const categorySlug = normalizeRequiredSlug(category, "category");
    const row = await queryOne<TopicSnapshotRow>(
      this.db,
      `
        SELECT
          id,
          category,
          generated_at::text,
          window_hours,
          source_count,
          topics,
          raw_payload,
          created_at::text
        FROM topic_snapshots
        WHERE category = $1 AND window_hours = $2
        ORDER BY generated_at DESC
        LIMIT 1
      `,
      [categorySlug, windowHours],
    );

    return row ? mapSnapshotRow(row) : null;
  }
}

export function isDevTopicSnapshot(
  snapshot: Pick<TopicSnapshotRecord, "raw_payload"> | null | undefined,
) {
  if (!snapshot?.raw_payload || typeof snapshot.raw_payload !== "object") {
    return false;
  }

  return (snapshot.raw_payload as { source?: unknown }).source === "dev_seed";
}

export function getTopicRankFromSnapshot(
  snapshot: TopicSnapshotRecord,
  topicSlugOrName: string,
) {
  const topicSlug = slugify(topicSlugOrName);
  const topicName = normalizeName(topicSlugOrName).toLowerCase();

  if (!topicSlug && !topicName) {
    return null;
  }

  const match = snapshot.topics.find((topic) => {
    return (
      topic.slug === topicSlug ||
      normalizeName(topic.name).toLowerCase() === topicName
    );
  });

  return match?.rank ?? null;
}

export function normalizeSnapshotTopics(topics: SnapshotTopicInput[]) {
  const seenRanks = new Set<number>();
  const normalizedTopics = topics
    .map((topic) => {
      const name = normalizeName(topic.name);
      if (!name) {
        return null;
      }

      const rank = toFiniteInteger(topic.rank);
      if (rank < 1 || seenRanks.has(rank)) {
        return null;
      }
      seenRanks.add(rank);

      const slug = slugify(topic.slug ?? name);
      if (!slug) {
        return null;
      }

      const score = toFiniteNumber(topic.score);
      const normalized: SnapshotTopic = {
        rank,
        name,
        slug,
        score,
      };

      if (typeof topic.confidence === "number" && Number.isFinite(topic.confidence)) {
        normalized.confidence = Math.max(0, Math.min(1, topic.confidence));
      }

      if (Array.isArray(topic.sources)) {
        const sources = topic.sources
          .map((source) => source.trim())
          .filter(Boolean);
        if (sources.length > 0) {
          normalized.sources = [...new Set(sources)];
        }
      }

      return normalized;
    })
    .filter((topic): topic is SnapshotTopic => Boolean(topic))
    .sort((left, right) => left.rank - right.rank);

  if (normalizedTopics.length === 0) {
    throw new HttpError(
      400,
      "INVALID_SNAPSHOT_TOPICS",
      "A topic snapshot must include at least one valid ranked topic.",
    );
  }

  return normalizedTopics;
}

function mapSnapshotRow(row: TopicSnapshotRow): TopicSnapshotRecord {
  return {
    id: row.id,
    category: row.category,
    generated_at: new Date(row.generated_at).toISOString(),
    window_hours: toFiniteInteger(row.window_hours),
    source_count: toFiniteInteger(row.source_count),
    topics: normalizeSnapshotTopics(parseSnapshotTopics(row.topics)),
    raw_payload: row.raw_payload,
    created_at: new Date(row.created_at).toISOString(),
  };
}

function parseSnapshotTopics(value: unknown): SnapshotTopicInput[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const topics: SnapshotTopicInput[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const topic = item as Record<string, unknown>;
    topics.push({
      rank: Number(topic.rank),
      name: typeof topic.name === "string" ? topic.name : "",
      slug: typeof topic.slug === "string" ? topic.slug : undefined,
      score: Number(topic.score),
      confidence:
        typeof topic.confidence === "number" ? topic.confidence : undefined,
      sources: Array.isArray(topic.sources)
        ? topic.sources.filter((source): source is string => typeof source === "string")
        : undefined,
    });
  }

  return topics;
}

function normalizeRequiredSlug(value: string, label: string) {
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

function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeIsoDate(value: string, label: string) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new HttpError(
      400,
      `INVALID_${label.toUpperCase()}`,
      `${label} must be a valid ISO timestamp.`,
    );
  }

  return new Date(parsed).toISOString();
}

function toFiniteInteger(value: number | string | null | undefined) {
  const numberValue = Number(value ?? 0);
  if (!Number.isFinite(numberValue)) {
    return 0;
  }

  return Math.trunc(numberValue);
}

function toFiniteNumber(value: number | string | null | undefined) {
  const numberValue = Number(value ?? 0);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function inferSourceCount(topics: SnapshotTopic[]) {
  const sources = new Set<string>();
  for (const topic of topics) {
    for (const source of topic.sources ?? []) {
      sources.add(source);
    }
  }

  return sources.size > 0 ? sources.size : topics.length;
}
