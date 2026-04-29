import type { AppDatabase } from "../../db/database.js";
import { queryOne, queryRows } from "../../db/query.js";
import type { Env } from "../../config/env.js";
import { createStableId, slugify } from "../../lib/ids.js";
import { CoinGeckoClient } from "./coingecko.client.js";
import type { NormalizedFeedItem } from "./feed.types.js";
import { FinnhubClient } from "./finnhub.client.js";
import { NewsApiClient } from "./newsapi.client.js";

type LiveFeedQuery = {
  category?: string | undefined;
  topic?: string | undefined;
  limit: number;
};

type HotTopicsQuery = {
  category?: string | undefined;
  window: string;
  limit: number;
};

type RefreshFeedInput = {
  category?: string | undefined;
  force?: boolean | undefined;
};

type TopicSeedRow = {
  id: string;
  slug: string;
  name: string;
};

type CategoryRecord = {
  id: string;
  slug: string;
  name: string;
};

type FeedLogger = {
  error: (input: unknown, message?: string) => void;
};

type RankedTopicCandidate = {
  topic: TopicSeedRow;
  category: CategoryRecord;
  mentions_count: number;
  previous_mentions_count: number | null;
  mentions_delta: number;
  mentions_delta_pct: number | null;
  unique_sources_count: number;
  breaking_news_count: number;
  weighted_mentions_score: number;
  heat_score: number;
  trend_direction: string;
  rank: number;
};

type HotTopicSnapshotRow = {
  topic_id: string;
  mentions_count: number | string;
  previous_mentions_count: number | string | null;
  mentions_delta: number | string;
  mentions_delta_pct: number | string | null;
  unique_sources_count: number | string;
  breaking_news_count: number | string;
  heat_score: number | string;
  trend_direction: string;
  rank: number | string;
  topic_slug: string;
  topic_name: string;
  category_slug: string | null;
  category_name: string | null;
};

type ScoredHotTopicRow = {
  topic_id: string;
  topic_slug: string;
  topic_name: string;
  mentions_count: number | string;
  previous_mentions_count: number | string | null;
  mentions_delta: number | string;
  mentions_delta_pct: number | string | null;
  unique_sources_count: number | string;
  breaking_news_count: number | string;
  weighted_mentions_score: number | string;
  heat_score: number | string;
  trend_direction: string;
  rank: number | string;
};

const categoryAliases: Record<string, string> = {
  technology: "tech"
};

export class FeedService {
  private readonly newsApiClient: NewsApiClient;
  private readonly finnhubClient: FinnhubClient;
  private readonly coingeckoClient: CoinGeckoClient;
  private readonly refreshState = new Map<string, number>();

  constructor(
    private readonly db: AppDatabase,
    private readonly env: Env,
    private readonly logger?: FeedLogger
  ) {
    this.newsApiClient = new NewsApiClient(env);
    this.finnhubClient = new FinnhubClient(env);
    this.coingeckoClient = new CoinGeckoClient(env);
  }

  async getLiveFeed(query: LiveFeedQuery) {
    const categorySlug = this.normalizeCategorySlug(query.category);
    await this.refreshIfStale(categorySlug, query.topic);

    const params: unknown[] = [];
    const where: string[] = [];

    if (categorySlug && categorySlug !== "trending") {
      where.push(`c.slug = $${params.length + 1}`);
      params.push(categorySlug);
    }

    if (query.topic) {
      where.push(
        `
          EXISTS (
            SELECT 1
            FROM news_item_topics nit
            JOIN topics t ON t.id = nit.topic_id
            WHERE nit.news_item_id = ni.id AND t.slug = $${params.length + 1}
          )
        `
      );
      params.push(query.topic);
    }

    const rows = await queryRows<{
      id: string;
      title: string;
      summary: string | null;
      url: string;
      image_uri: string | null;
      published_at: string;
      is_breaking: boolean;
      source_slug: string;
      source_name: string;
      category_slug: string | null;
      category_name: string | null;
    }>(
      this.db,
      `
        SELECT
          ni.id,
          ni.title,
          ni.summary,
          ni.url,
          ni.image_uri,
          ni.published_at::text,
          ni.is_breaking,
          ns.slug AS source_slug,
          ns.name AS source_name,
          c.slug AS category_slug,
          c.name AS category_name
        FROM news_items ni
        JOIN news_sources ns ON ns.id = ni.source_id
        LEFT JOIN categories c ON c.id = ni.category_id
        ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY ni.published_at DESC
        LIMIT ${query.limit}
      `,
      params
    );

    const items = await Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        title: row.title,
        summary: row.summary,
        url: row.url,
        image_uri: row.image_uri,
        published_at: row.published_at,
        is_breaking: Boolean(row.is_breaking),
        source: {
          slug: row.source_slug,
          name: row.source_name
        },
        category: row.category_slug
          ? {
              slug: row.category_slug,
              name: row.category_name
            }
          : null,
        topics: await queryRows<{ slug: string; name: string }>(
          this.db,
          `
            SELECT t.slug, t.name
            FROM news_item_topics nit
            JOIN topics t ON t.id = nit.topic_id
            WHERE nit.news_item_id = $1
            ORDER BY nit.is_primary DESC, t.name ASC
          `,
          [row.id]
        )
      }))
    );

    return { data: { items } };
  }

  async getHotTopics(query: HotTopicsQuery) {
    const normalizedCategorySlug = this.normalizeCategorySlug(query.category);
    const categorySlug = normalizedCategorySlug === "trending" ? undefined : normalizedCategorySlug;
    await this.ensureHotTopicSnapshots(categorySlug, query.window);

    const rows = await this.queryHotTopicRows(categorySlug, query.window, query.limit);

    return {
      data: {
        window: query.window,
        category: categorySlug && rows[0]?.category_slug
          ? {
              slug: rows[0].category_slug,
              name: rows[0].category_name
            }
          : null,
        topics: rows.map((row) => ({
          id: row.topic_id,
          slug: row.topic_slug,
          name: row.topic_name,
          mentions_count: this.toNumber(row.mentions_count),
          previous_mentions_count: this.toNullableNumber(row.previous_mentions_count),
          mentions_delta: this.toNumber(row.mentions_delta),
          mentions_delta_pct: this.toNullableNumber(row.mentions_delta_pct),
          unique_sources_count: this.toNumber(row.unique_sources_count),
          breaking_news_count: this.toNumber(row.breaking_news_count),
          trend_direction: row.trend_direction,
          heat_score: this.toNumber(row.heat_score),
          rank: this.toNumber(row.rank)
        }))
      }
    };
  }

  private async ensureHotTopicSnapshots(categorySlug: string | undefined, window: string) {
    const existing = await queryOne<{ exists: number }>(
      this.db,
      `
        SELECT 1 AS exists
        FROM hot_topic_snapshots hts
        LEFT JOIN categories c ON c.id = hts.category_id
        WHERE hts.window_type = $1
        ${categorySlug ? "AND c.slug = $2" : ""}
        LIMIT 1
      `,
      categorySlug ? [window, categorySlug] : [window]
    );

    if (existing) {
      return;
    }

    await this.rebuildHotTopicSnapshots(categorySlug);
  }

  private async queryHotTopicRows(categorySlug: string | undefined, window: string, limit: number) {
    const params: unknown[] = [window];
    const categoryJoin = categorySlug ? "JOIN categories latest_c ON latest_c.id = hts.category_id" : "";
    const categoryFilter = categorySlug ? `AND latest_c.slug = $${params.length + 1}` : "";

    if (categorySlug) {
      params.push(categorySlug);
    }

    params.push(limit);
    const limitParam = `$${params.length}`;

    return queryRows<HotTopicSnapshotRow>(
      this.db,
      `
        WITH latest AS (
          SELECT hts.category_id, MAX(hts.window_end) AS window_end
          FROM hot_topic_snapshots hts
          ${categoryJoin}
          WHERE hts.window_type = $1
          ${categoryFilter}
          GROUP BY hts.category_id
        )
        SELECT
          hts.topic_id,
          hts.mentions_count,
          hts.previous_mentions_count,
          hts.mentions_delta,
          hts.mentions_delta_pct,
          hts.unique_sources_count,
          hts.breaking_news_count,
          hts.heat_score,
          hts.trend_direction,
          hts.rank,
          t.slug AS topic_slug,
          t.name AS topic_name,
          c.slug AS category_slug,
          c.name AS category_name
        FROM latest
        JOIN hot_topic_snapshots hts
          ON hts.category_id IS NOT DISTINCT FROM latest.category_id
          AND hts.window_end = latest.window_end
          AND hts.window_type = $1
        JOIN topics t ON t.id = hts.topic_id
        LEFT JOIN categories c ON c.id = hts.category_id
        ORDER BY hts.heat_score DESC, hts.rank ASC
        LIMIT ${limitParam}
      `,
      params
    );
  }

  async refreshFeed(input: RefreshFeedInput = {}) {
    const categorySlug = this.normalizeCategorySlug(input.category);
    const refreshKey = categorySlug ?? "all";
    const force = input.force ?? true;

    if (!force && !this.isRefreshStale(refreshKey)) {
      return {
        data: {
          refreshed: false,
          category: categorySlug ?? null,
          categories: [],
          reason: "ttl_active"
        }
      };
    }

    const categories = await this.performRefresh(categorySlug);
    this.markRefresh(refreshKey);

    if (!categorySlug) {
      for (const category of categories) {
        this.markRefresh(category);
      }
    }

    return {
      data: {
        refreshed: true,
        category: categorySlug ?? null,
        categories,
        refreshed_at: new Date().toISOString()
      }
    };
  }

  private async refreshIfStale(categorySlug?: string, topicSlug?: string) {
    let effectiveCategory = categorySlug;

    if (!effectiveCategory && topicSlug) {
      const topicCategory = await queryOne<{ slug: string }>(
        this.db,
        `
          SELECT c.slug
          FROM topics t
          JOIN categories c ON c.id = t.category_id
          WHERE t.slug = $1
          LIMIT 1
        `,
        [topicSlug]
      );

      effectiveCategory = topicCategory?.slug;
    }

    const refreshKey = effectiveCategory ?? "all";
    if (!this.isRefreshStale(refreshKey)) {
      return;
    }

    const categories = await this.performRefresh(effectiveCategory);
    this.markRefresh(refreshKey);

    if (!effectiveCategory) {
      for (const category of categories) {
        this.markRefresh(category);
      }
    }
  }

  private isRefreshStale(refreshKey: string) {
    const lastRefresh = this.refreshState.get(refreshKey);
    const ttlMs = this.env.FEED_REFRESH_TTL_MINUTES * 60_000;
    return !lastRefresh || Date.now() - lastRefresh >= ttlMs;
  }

  private markRefresh(refreshKey: string) {
    this.refreshState.set(refreshKey, Date.now());
  }

  private async performRefresh(categorySlug?: string) {
    if (categorySlug) {
      await this.refreshCategory(categorySlug);
      return [categorySlug];
    }

    const categories = await queryRows<CategoryRecord>(
      this.db,
      "SELECT id, slug, name FROM categories WHERE is_active = true ORDER BY sort_order ASC, name ASC"
    );
    const refreshCategories = ["trending", ...categories.map((category) => category.slug)];

    for (const category of refreshCategories) {
      await this.refreshCategory(category);
    }

    return refreshCategories;
  }

  private async refreshCategory(categorySlug: string) {
    if (categorySlug === "crypto") {
      await this.safeRefresh(`refreshCategory:${categorySlug}`, async () => {
        await this.refreshCryptoSignals();
      });
      await this.rebuildHotTopicSnapshots("crypto");
      return;
    }

    if (categorySlug === "trending") {
      await this.safeRefresh(`refreshCategory:${categorySlug}`, async () => {
        const items = await this.newsApiClient.fetchCategoryHeadlines("trending");
        await this.storeTrendingNewsItems(items);
      });
      await this.rebuildHotTopicSnapshots();
      return;
    }

    const category = await queryOne<CategoryRecord>(
      this.db,
      "SELECT id, slug, name FROM categories WHERE slug = $1 LIMIT 1",
      [categorySlug]
    );

    if (!category) {
      return;
    }

    await this.safeRefresh(`refreshCategory:${categorySlug}`, async () => {
      const items = await this.fetchCategoryItems(categorySlug);
      await this.storeNewsItems(category.id, items);
    });
    await this.rebuildHotTopicSnapshots(categorySlug);
  }

  private async fetchCategoryItems(categorySlug: string): Promise<NormalizedFeedItem[]> {
    if (categorySlug === "finance") {
      const dateRange = this.getFinnhubCompanyNewsDateRange();
      const symbols = this.env.FINNHUB_FINANCE_SYMBOLS.split(",")
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean);

      const batches = await Promise.all(
        symbols.map((symbol) =>
          this.fetchOptional(`fetchCategoryItems:finance:finnhub:${symbol}`, () =>
            this.finnhubClient.fetchCompanyNews(symbol, dateRange, 20), []
          )
        )
      );

      return this.dedupeItems(batches.flat()).slice(0, 20);
    }

    if (categorySlug === "tech" || categorySlug === "technology") {
      const [finnhubItems, newsApiItems] = await Promise.all([
        this.fetchOptional("fetchCategoryItems:tech:finnhub", () => this.finnhubClient.fetchMarketNews("technology", 10), []),
        this.fetchOptional("fetchCategoryItems:tech:newsapi", () =>
          this.newsApiClient.fetchCategoryHeadlines("technology", { limit: 10, includeCountry: false }), []
        )
      ]);

      return this.dedupeItems([...finnhubItems, ...newsApiItems]);
    }

    if (categorySlug === "politics") {
      return this.newsApiClient.search("politics", { limit: 10 });
    }

    return this.newsApiClient.fetchCategoryHeadlines(categorySlug);
  }

  private getFinnhubCompanyNewsDateRange() {
    const to = new Date();
    const from = new Date(to);
    from.setUTCDate(from.getUTCDate() - this.env.FINNHUB_COMPANY_NEWS_LOOKBACK_DAYS);

    return {
      from: this.formatDateOnly(from),
      to: this.formatDateOnly(to)
    };
  }

  private normalizeCategorySlug(categorySlug?: string) {
    return categorySlug ? (categoryAliases[categorySlug] ?? categorySlug) : undefined;
  }

  private formatDateOnly(date: Date) {
    return date.toISOString().slice(0, 10);
  }

  private dedupeItems(items: NormalizedFeedItem[]) {
    const seenUrls = new Set<string>();
    const deduped: NormalizedFeedItem[] = [];

    for (const item of items) {
      if (seenUrls.has(item.url)) {
        continue;
      }

      seenUrls.add(item.url);
      deduped.push(item);
    }

    return deduped.sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt));
  }

  private async fetchOptional<T>(context: string, operation: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      this.logger?.error({ err: error, context }, "Feed provider request failed.");
      return fallback;
    }
  }

  private async refreshCryptoSignals() {
    const category = await queryOne<CategoryRecord>(
      this.db,
      "SELECT id, slug, name FROM categories WHERE slug = 'crypto' LIMIT 1"
    );

    if (!category) {
      return;
    }

    const [headlineItems, marketPulse] = await Promise.all([
      this.fetchOptional("refreshCryptoSignals:newsapi", () =>
        this.newsApiClient.search("crypto OR bitcoin OR ethereum OR solana"), []
      ),
      this.fetchOptional("refreshCryptoSignals:coingecko", () => this.coingeckoClient.fetchTopMarketPulse(), [])
    ]);

    await this.storeNewsItems(category.id, headlineItems, undefined, true);
    await this.storeCoinGeckoPulse(category.id, marketPulse);
  }

  private async storeCoinGeckoPulse(
    categoryId: string,
    items: Array<{
      title: string;
      summary: string;
      url: string;
      imageUri?: string;
      publishedAt: string;
      mentionWeight: number;
      topicHints: string[];
      rawPayload: unknown;
    }>
  ) {
    const sourceId = await this.ensureSource("CoinGecko", "market-data", "https://api.coingecko.com/api/v3");

    for (const item of items) {
      const id = createStableId("news", item.url);
      await this.db.query(
        `
          INSERT INTO news_items (
            id, source_id, external_id, title, summary, url, image_uri, published_at, language, category_id,
            sentiment_label, sentiment_score, is_breaking, mention_weight, raw_payload_json
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15::jsonb
          )
          ON CONFLICT (url) DO NOTHING
        `,
        [
          id,
          sourceId,
          id,
          item.title,
          item.summary,
          item.url,
          item.imageUri ?? null,
          item.publishedAt,
          "en",
          categoryId,
          null,
          null,
          true,
          item.mentionWeight,
          JSON.stringify(item.rawPayload)
        ]
      );

      await this.linkTopicsAndMarkets(id, categoryId, `${item.title} ${item.summary}`, item.topicHints);
    }
  }

  private async storeNewsItems(
    categoryId: string | null,
    items: NormalizedFeedItem[],
    topicHints?: string[],
    isCryptoSearch = false
  ) {
    if (items.length === 0) {
      return;
    }

    for (const item of items) {
      const sourceId = await this.ensureSource(item.sourceName, "news-api", item.sourceUrl);
      const id = createStableId("news", item.url);

      await this.db.query(
        `
          INSERT INTO news_items (
            id, source_id, external_id, title, summary, url, image_uri, published_at, language, category_id,
            sentiment_label, sentiment_score, is_breaking, mention_weight, raw_payload_json
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15::jsonb
          )
          ON CONFLICT (url) DO NOTHING
        `,
        [
          id,
          sourceId,
          id,
          item.title,
          item.summary ?? null,
          item.url,
          item.imageUri ?? null,
          item.publishedAt,
          "en",
          categoryId,
          null,
          null,
          item.isBreaking,
          item.mentionWeight,
          JSON.stringify(item.rawPayload)
        ]
      );

      if (categoryId) {
        await this.linkTopicsAndMarkets(id, categoryId, `${item.title} ${item.summary ?? ""}`, topicHints, isCryptoSearch);
      }
    }
  }

  private async storeTrendingNewsItems(items: NormalizedFeedItem[]) {
    if (items.length === 0) {
      return;
    }

    for (const item of items) {
      const sourceId = await this.ensureSource(item.sourceName, "news-api", item.sourceUrl);
      const id = createStableId("news", item.url);

      await this.db.query(
        `
          INSERT INTO news_items (
            id, source_id, external_id, title, summary, url, image_uri, published_at, language, category_id,
            sentiment_label, sentiment_score, is_breaking, mention_weight, raw_payload_json
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15::jsonb
          )
          ON CONFLICT (url) DO NOTHING
        `,
        [
          id,
          sourceId,
          id,
          item.title,
          item.summary ?? null,
          item.url,
          item.imageUri ?? null,
          item.publishedAt,
          "en",
          null,
          null,
          null,
          item.isBreaking,
          item.mentionWeight,
          JSON.stringify(item.rawPayload)
        ]
      );

      await this.linkTopicsAcrossAllCategories(id, `${item.title} ${item.summary ?? ""}`);
    }
  }

  private async linkTopicsAndMarkets(
    newsItemId: string,
    categoryId: string,
    text: string,
    topicHints?: string[],
    isCryptoSearch = false
  ) {
    const topics = await queryRows<TopicSeedRow>(
      this.db,
      "SELECT id, slug, name FROM topics WHERE category_id = $1",
      [categoryId]
    );

    const normalized = text.toLowerCase();
    const hinted = topicHints?.map((hint) => hint.toLowerCase()) ?? [];

    const matches = topics.filter((topic) => {
      const tokens = [topic.slug.replace(/-/g, " "), topic.name.toLowerCase(), ...hinted];
      return tokens.some((token) => token.length > 2 && normalized.includes(token));
    });

    const fallbackTopic =
      matches.length === 0 && isCryptoSearch
        ? topics.find((topic) => topic.slug === "bitcoin" || topic.slug === "solana")
        : null;

    const finalMatches = matches.length > 0 ? matches : fallbackTopic ? [fallbackTopic] : [];

    for (const [index, topic] of finalMatches.entries()) {
      await this.insertTopicAndMarketLinks(newsItemId, topic.id, index);
    }
  }

  private async linkTopicsAcrossAllCategories(newsItemId: string, text: string) {
    const topics = await queryRows<TopicSeedRow>(this.db, "SELECT id, slug, name FROM topics");
    const normalized = text.toLowerCase();

    const matches = topics.filter((topic) => {
      const tokens = [topic.slug.replace(/-/g, " "), topic.name.toLowerCase()];
      return tokens.some((token) => token.length > 2 && normalized.includes(token));
    });

    for (const [index, topic] of matches.entries()) {
      await this.insertTopicAndMarketLinks(newsItemId, topic.id, index);
    }
  }

  private async insertTopicAndMarketLinks(newsItemId: string, topicId: string, index: number) {
    await this.db.query(
      `
        INSERT INTO news_item_topics (
          id, news_item_id, topic_id, relevance_score, is_primary
        ) VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (news_item_id, topic_id) DO NOTHING
      `,
      [createStableId("nit", `${newsItemId}:${topicId}`), newsItemId, topicId, index === 0 ? 1 : 0.75, index === 0]
    );

    const markets = await queryRows<{ market_id: string }>(
      this.db,
      `
        SELECT DISTINCT mt.market_id
        FROM market_topics mt
        WHERE mt.topic_id = $1
      `,
      [topicId]
    );

    for (const market of markets) {
      await this.db.query(
        `
          INSERT INTO news_item_markets (
            id, news_item_id, market_id, relevance_score
          ) VALUES ($1, $2, $3, $4)
          ON CONFLICT (news_item_id, market_id) DO NOTHING
        `,
        [createStableId("nim", `${newsItemId}:${market.market_id}`), newsItemId, market.market_id, index === 0 ? 1 : 0.7]
      );
    }
  }

  private async ensureSource(name: string, sourceType: string, baseUrl?: string | undefined) {
    const slug = slugify(name);
    const existing = await queryOne<{ id: string }>(
      this.db,
      "SELECT id FROM news_sources WHERE slug = $1 LIMIT 1",
      [slug]
    );

    if (existing) {
      return existing.id;
    }

    const id = createStableId("source", slug);
    await this.db.query(
      `
        INSERT INTO news_sources (id, slug, name, source_type, base_url, is_active, reliability_score)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (slug) DO NOTHING
      `,
      [id, slug, name, sourceType, baseUrl ?? null, true, 0.7]
    );

    return id;
  }

  private async rebuildHotTopicSnapshots(categorySlug?: string) {
    const categories = categorySlug
      ? ((await queryRows<CategoryRecord>(this.db, "SELECT id, slug, name FROM categories WHERE slug = $1 LIMIT 1", [
          categorySlug
        ])) as CategoryRecord[])
      : ((await queryRows<CategoryRecord>(this.db, "SELECT id, slug, name FROM categories")) as CategoryRecord[]);

    const now = new Date();
    const windowEnd = now.toISOString();
    const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    for (const category of categories) {
      const scoredRows = await this.queryScoredHotTopicRows(category.id, windowStart, windowEnd);
      const rankedTopicsWithRank = this.toRankedTopicCandidates(category, scoredRows);

      await this.insertTopicMentionTimeseries(rankedTopicsWithRank, windowStart, windowEnd);
      await this.insertHotTopicSnapshots(rankedTopicsWithRank, windowStart, windowEnd);
    }
  }

  private async queryScoredHotTopicRows(categoryId: string, windowStart: string, windowEnd: string) {
    return queryRows<ScoredHotTopicRow>(
      this.db,
      `
        WITH category_topics AS (
          SELECT id AS topic_id, slug AS topic_slug, name AS topic_name
          FROM topics
          WHERE category_id = $1
        ),
        current_mentions AS (
          SELECT
            ct.topic_id,
            COUNT(DISTINCT ni.id)::int AS mentions_count,
            COUNT(DISTINCT ni.source_id)::int AS unique_sources_count,
            COUNT(DISTINCT CASE WHEN ni.is_breaking = true THEN ni.id END)::int AS breaking_news_count,
            COALESCE(
              SUM(CASE WHEN ni.id IS NULL THEN 0 ELSE ni.mention_weight * nit.relevance_score END),
              0
            )::double precision AS weighted_mentions_score
          FROM category_topics ct
          LEFT JOIN news_item_topics nit ON nit.topic_id = ct.topic_id
          LEFT JOIN news_items ni
            ON ni.id = nit.news_item_id
            AND ni.published_at >= $2::timestamptz
            AND ni.published_at <= $3::timestamptz
          GROUP BY ct.topic_id
        ),
        previous_mentions AS (
          SELECT DISTINCT ON (tmt.topic_id)
            tmt.topic_id,
            tmt.mentions_count
          FROM topic_mention_timeseries tmt
          JOIN category_topics ct ON ct.topic_id = tmt.topic_id
          WHERE tmt.bucket_granularity = '24h'
            AND tmt.bucket_end_at < $3::timestamptz
          ORDER BY tmt.topic_id, tmt.bucket_end_at DESC
        ),
        base AS (
          SELECT
            ct.topic_id,
            ct.topic_slug,
            ct.topic_name,
            cm.mentions_count,
            pm.mentions_count AS previous_mentions_count,
            cm.mentions_count - COALESCE(pm.mentions_count, 0) AS mentions_delta,
            CASE
              WHEN pm.mentions_count > 0 THEN
                ROUND(((cm.mentions_count - pm.mentions_count)::numeric / pm.mentions_count * 100), 2)::double precision
              ELSE NULL
            END AS mentions_delta_pct,
            cm.unique_sources_count,
            cm.breaking_news_count,
            cm.weighted_mentions_score,
            CASE
              WHEN cm.mentions_count - COALESCE(pm.mentions_count, 0) > 0 THEN 'up'
              WHEN cm.mentions_count - COALESCE(pm.mentions_count, 0) < 0 THEN 'down'
              WHEN cm.mentions_count > 0 THEN 'flat'
              ELSE 'new'
            END AS trend_direction
          FROM category_topics ct
          JOIN current_mentions cm ON cm.topic_id = ct.topic_id
          LEFT JOIN previous_mentions pm ON pm.topic_id = ct.topic_id
        ),
        scored AS (
          SELECT
            *,
            ROUND(
              (
                weighted_mentions_score +
                unique_sources_count * 2 +
                breaking_news_count * 3 +
                COALESCE(mentions_delta_pct, mentions_count)
              )::numeric,
              2
            )::double precision AS heat_score
          FROM base
        )
        SELECT
          *,
          ROW_NUMBER() OVER (ORDER BY heat_score DESC, mentions_count DESC)::int AS rank
        FROM scored
        ORDER BY rank ASC
      `,
      [categoryId, windowStart, windowEnd]
    );
  }

  private toRankedTopicCandidates(category: CategoryRecord, rows: ScoredHotTopicRow[]): RankedTopicCandidate[] {
    return rows.map((row) => ({
      topic: {
        id: row.topic_id,
        slug: row.topic_slug,
        name: row.topic_name
      },
      category,
      mentions_count: this.toNumber(row.mentions_count),
      previous_mentions_count: this.toNullableNumber(row.previous_mentions_count),
      mentions_delta: this.toNumber(row.mentions_delta),
      mentions_delta_pct: this.toNullableNumber(row.mentions_delta_pct),
      unique_sources_count: this.toNumber(row.unique_sources_count),
      breaking_news_count: this.toNumber(row.breaking_news_count),
      weighted_mentions_score: this.toNumber(row.weighted_mentions_score),
      heat_score: this.toNumber(row.heat_score),
      trend_direction: row.trend_direction,
      rank: this.toNumber(row.rank)
    }));
  }

  private async insertTopicMentionTimeseries(items: RankedTopicCandidate[], windowStart: string, windowEnd: string) {
    if (items.length === 0) {
      return;
    }

    const params: unknown[] = [];
    const values = items.map((item) => {
      const index = params.length;
      params.push(
        createStableId("mts", `${item.topic.id}:${windowEnd}:24h`),
        item.topic.id,
        windowStart,
        windowEnd,
        "24h",
        item.mentions_count,
        item.previous_mentions_count,
        item.unique_sources_count,
        item.breaking_news_count,
        item.weighted_mentions_score
      );

      return `($${index + 1}, $${index + 2}, $${index + 3}, $${index + 4}, $${index + 5}, $${index + 6}, $${index + 7}, $${index + 8}, $${index + 9}, $${index + 10}, now(), now())`;
    });

    await this.db.query(
      `
        INSERT INTO topic_mention_timeseries (
          id, topic_id, bucket_start_at, bucket_end_at, bucket_granularity, mentions_count, previous_mentions_count,
          unique_sources_count, breaking_news_count, weighted_mentions_score, created_at, updated_at
        ) VALUES ${values.join(", ")}
        ON CONFLICT (topic_id, bucket_start_at, bucket_granularity)
        DO UPDATE SET
          mentions_count = EXCLUDED.mentions_count,
          previous_mentions_count = EXCLUDED.previous_mentions_count,
          unique_sources_count = EXCLUDED.unique_sources_count,
          breaking_news_count = EXCLUDED.breaking_news_count,
          weighted_mentions_score = EXCLUDED.weighted_mentions_score,
          updated_at = now()
      `,
      params
    );
  }

  private async insertHotTopicSnapshots(items: RankedTopicCandidate[], windowStart: string, windowEnd: string) {
    if (items.length === 0) {
      return;
    }

    const params: unknown[] = [];
    const values = items.map((item) => {
      const index = params.length;
      params.push(
        createStableId("hot", `${item.topic.id}:${windowEnd}:24h`),
        item.category.id,
        item.topic.id,
        "24h",
        windowStart,
        windowEnd,
        item.mentions_count,
        item.previous_mentions_count,
        item.mentions_delta,
        item.mentions_delta_pct,
        item.unique_sources_count,
        item.breaking_news_count,
        item.heat_score,
        item.trend_direction,
        item.rank
      );

      return `($${index + 1}, $${index + 2}, $${index + 3}, $${index + 4}, $${index + 5}, $${index + 6}, $${index + 7}, $${index + 8}, $${index + 9}, $${index + 10}, $${index + 11}, $${index + 12}, $${index + 13}, $${index + 14}, $${index + 15}, now(), now())`;
    });

    await this.db.query(
      `
        INSERT INTO hot_topic_snapshots (
          id, category_id, topic_id, window_type, window_start, window_end, mentions_count, previous_mentions_count,
          mentions_delta, mentions_delta_pct, unique_sources_count, breaking_news_count, heat_score, trend_direction,
          rank, created_at, updated_at
        ) VALUES ${values.join(", ")}
        ON CONFLICT (topic_id, window_type, window_end)
        DO UPDATE SET
          category_id = EXCLUDED.category_id,
          mentions_count = EXCLUDED.mentions_count,
          previous_mentions_count = EXCLUDED.previous_mentions_count,
          mentions_delta = EXCLUDED.mentions_delta,
          mentions_delta_pct = EXCLUDED.mentions_delta_pct,
          unique_sources_count = EXCLUDED.unique_sources_count,
          breaking_news_count = EXCLUDED.breaking_news_count,
          heat_score = EXCLUDED.heat_score,
          trend_direction = EXCLUDED.trend_direction,
          rank = EXCLUDED.rank,
          updated_at = now()
      `,
      params
    );
  }

  private toNumber(value: number | string | null | undefined) {
    const numberValue = Number(value ?? 0);
    return Number.isFinite(numberValue) ? numberValue : 0;
  }

  private toNullableNumber(value: number | string | null | undefined) {
    if (value === null || value === undefined) {
      return null;
    }

    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : null;
  }

  private async safeRefresh(context: string, operation: () => Promise<void>) {
    try {
      await operation();
    } catch (error) {
      this.logger?.error({ err: error, context }, "Feed refresh operation failed.");
      return;
    }
  }
}
