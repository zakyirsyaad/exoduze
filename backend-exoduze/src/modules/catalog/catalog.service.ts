import type { PoolClient } from "pg";

import type { AppDatabase } from "../../db/database.js";
import { queryOne, queryRows } from "../../db/query.js";
import { createStableId, slugify } from "../../lib/ids.js";
import { HttpError, isPgErrorCode } from "../../lib/http-error.js";
import {
  marketImageLateralSql,
  usableImageExpressionSql,
} from "../markets/market-image-sql.js";
import { effectiveMarketStatusSql } from "../markets/market-status.js";

type CategoryPageQuery = {
  topic?: string | undefined;
  status?: string | undefined;
  sort?: string | undefined;
  cursor?: string | undefined;
  limit: number;
};

type CategoryRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  market_count: string | number;
  active_market_count: string | number;
};

type TopicRow = {
  id: string;
  slug: string;
  name: string;
  market_count: string | number;
  active_market_count: string | number;
};

type MarketRow = {
  id: string;
  slug: string;
  title: string;
  short_description: string;
  image_uri: string | null;
  status: string;
  opens_at: string;
  join_deadline_at: string;
  decision_cutoff_at: string;
  closes_at: string;
  resolves_at: string | null;
  settlement_asset: string;
  total_liquidity_usdc: string;
  category_id: string;
  category_slug: string;
  category_name: string;
};

type CategoryAdminRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  market_count: string | number;
  active_market_count: string | number;
};

type TopicAdminRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  is_active: boolean;
  category_id: string;
  category_slug: string;
  category_name: string;
  market_count: string | number;
  active_market_count: string | number;
};

type CategoryMutationInput = {
  slug?: string | undefined;
  name: string;
  description?: string | null | undefined;
  sortOrder: number;
  isActive: boolean;
};

type TopicMutationInput = {
  category: string;
  slug?: string | undefined;
  name: string;
  description?: string | null | undefined;
  isActive: boolean;
};

export class CatalogService {
  constructor(private readonly db: AppDatabase) {}

  async listCategories() {
    const rows = await queryRows<CategoryRow>(
      this.db,
      `
        SELECT
          c.id,
          c.slug,
          c.name,
          c.description,
          COUNT(DISTINCT m.id) AS market_count,
          COUNT(DISTINCT CASE WHEN (${effectiveMarketStatusSql("m")}) IN ('open', 'upcoming', 'resolving') THEN m.id END) AS active_market_count
        FROM categories c
        LEFT JOIN markets m ON m.category_id = c.id
        WHERE c.is_active = true
        GROUP BY c.id
        ORDER BY c.sort_order ASC, c.name ASC
      `,
    );

    return {
      data: rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        name: row.name,
        description: row.description,
        market_count: Number(row.market_count),
        active_market_count: Number(row.active_market_count),
      })),
    };
  }

  async getCategoryPage(categorySlug: string, query: CategoryPageQuery) {
    const category = await queryOne<CategoryRow>(
      this.db,
      `
        SELECT
          c.id,
          c.slug,
          c.name,
          c.description,
          COUNT(DISTINCT m.id) AS market_count,
          COUNT(DISTINCT CASE WHEN (${effectiveMarketStatusSql("m")}) IN ('open', 'upcoming', 'resolving') THEN m.id END) AS active_market_count
        FROM categories c
        LEFT JOIN markets m ON m.category_id = c.id
        WHERE c.slug = $1
        GROUP BY c.id
      `,
      [categorySlug],
    );

    if (!category) {
      return null;
    }

    const topics = await queryRows<TopicRow>(
      this.db,
      `
        SELECT
          t.id,
          t.slug,
          t.name,
          COUNT(DISTINCT mt.market_id) AS market_count,
          COUNT(DISTINCT CASE WHEN (${effectiveMarketStatusSql("m")}) IN ('open', 'upcoming', 'resolving') THEN mt.market_id END) AS active_market_count
        FROM topics t
        LEFT JOIN market_topics mt ON mt.topic_id = t.id
        LEFT JOIN markets m ON m.id = mt.market_id
        WHERE t.category_id = $1 AND t.is_active = true
        GROUP BY t.id
        ORDER BY market_count DESC, t.name ASC
      `,
      [category.id],
    );

    let marketRows = await queryRows<MarketRow>(
      this.db,
      `
        SELECT
          m.id,
          m.slug,
          m.title,
          m.short_description,
          COALESCE(${usableImageExpressionSql("m.image_uri")}, market_image.image_uri) AS image_uri,
          (${effectiveMarketStatusSql("m")}) AS status,
          m.opens_at::text,
          m.join_deadline_at::text,
          m.decision_cutoff_at::text,
          m.closes_at::text,
          m.resolves_at::text,
          m.settlement_asset,
          m.total_liquidity_usdc::text,
          c.id AS category_id,
          c.slug AS category_slug,
          c.name AS category_name
        FROM markets m
        JOIN categories c ON c.id = m.category_id
        ${marketImageLateralSql("m")}
        WHERE c.id = $1
      `,
      [category.id],
    );

    if (query.status) {
      marketRows = marketRows.filter((row) => row.status === query.status);
    }

    if (query.topic) {
      const topicSlug = query.topic;
      const filtered: MarketRow[] = [];
      for (const row of marketRows) {
        const exists = await queryOne<{ found: number }>(
          this.db,
          `
            SELECT 1 AS found
            FROM market_topics mt
            JOIN topics t ON t.id = mt.topic_id
            WHERE mt.market_id = $1 AND t.slug = $2
            LIMIT 1
          `,
          [row.id, topicSlug],
        );

        if (exists) {
          filtered.push(row);
        }
      }
      marketRows = filtered;
    }

    const sorted = [...marketRows].sort((left, right) => {
      if (query.sort === "most_liquid") {
        return (
          Number(right.total_liquidity_usdc) - Number(left.total_liquidity_usdc)
        );
      }

      if (query.sort === "newest") {
        return Date.parse(right.opens_at) - Date.parse(left.opens_at);
      }

      return (
        Date.parse(left.decision_cutoff_at) -
        Date.parse(right.decision_cutoff_at)
      );
    });

    let startIndex = 0;
    if (query.cursor) {
      const cursorIndex = sorted.findIndex(
        (row) => row.id === query.cursor || row.slug === query.cursor,
      );
      startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0;
    }

    const sliced = sorted.slice(startIndex, startIndex + query.limit);
    const nextCursor = sorted[startIndex + query.limit]?.id ?? null;

    const markets = await Promise.all(
      sliced.map(async (row) => {
        const topicRows = await queryRows<{
          id: string;
          slug: string;
          name: string;
        }>(
          this.db,
          `
            SELECT t.id, t.slug, t.name
            FROM market_topics mt
            JOIN topics t ON t.id = mt.topic_id
            WHERE mt.market_id = $1
            ORDER BY mt.is_primary DESC, t.name ASC
          `,
          [row.id],
        );

        const totalAgents = await queryOne<{ count: string | number }>(
          this.db,
          "SELECT COUNT(*) AS count FROM market_agents WHERE market_id = $1",
          [row.id],
        );

        const featuredAgents = await queryRows<{
          id: string;
          name: string;
          avatar_uri: string | null;
        }>(
          this.db,
          `
            SELECT
              a.id,
              a.name,
              a.avatar_uri
            FROM market_agents ma
            JOIN agents a ON a.id = ma.agent_id
            LEFT JOIN user_positions up ON up.market_agent_id = ma.id
            WHERE ma.market_id = $1
            GROUP BY a.id
            ORDER BY COALESCE(SUM(up.stake_usdc), 0) DESC, a.name ASC
            LIMIT 3
          `,
          [row.id],
        );

        const lastUpdated = await queryOne<{ last_updated_at: string | null }>(
          this.db,
          `
            SELECT MAX(d.decided_at)::text AS last_updated_at
            FROM market_agents ma
            LEFT JOIN agent_market_decisions d ON d.market_agent_id = ma.id
            WHERE ma.market_id = $1
          `,
          [row.id],
        );

        return {
          id: row.id,
          slug: row.slug,
          title: row.title,
          short_description: row.short_description,
          image_uri: row.image_uri,
          status: row.status,
          category: {
            id: row.category_id,
            slug: row.category_slug,
            name: row.category_name,
          },
          topics: topicRows,
          timing: {
            opens_at: row.opens_at,
            join_deadline_at: row.join_deadline_at,
            decision_cutoff_at: row.decision_cutoff_at,
            closes_at: row.closes_at,
            resolves_at: row.resolves_at,
          },
          liquidity: {
            settlement_asset: row.settlement_asset,
            total_liquidity_usdc: row.total_liquidity_usdc,
          },
          agents_summary: {
            total_agents: Number(totalAgents?.count ?? 0),
          },
          featured_agents: featuredAgents,
          decision_snapshot: {
            last_updated_at: lastUpdated?.last_updated_at ?? null,
          },
        };
      }),
    );

    return {
      data: {
        category: {
          id: category.id,
          slug: category.slug,
          name: category.name,
          description: category.description,
          market_count: Number(category.market_count),
          active_market_count: Number(category.active_market_count),
        },
        filters: {
          selected_topic: query.topic
            ? (() => {
                const topic = topics.find(
                  (entry) => entry.slug === query.topic,
                );
                return topic
                  ? { slug: topic.slug, name: topic.name }
                  : { slug: query.topic, name: query.topic };
              })()
            : null,
          selected_status: query.status ?? null,
          selected_sort: query.sort ?? "ending_soon",
        },
        topics: topics.map((topic) => ({
          id: topic.id,
          slug: topic.slug,
          name: topic.name,
          market_count: Number(topic.market_count),
          active_market_count: Number(topic.active_market_count),
        })),
        markets,
        page_info: {
          next_cursor: nextCursor,
          has_next_page: nextCursor !== null,
          limit: query.limit,
        },
      },
    };
  }

  async createCategory(input: CategoryMutationInput) {
    const client = await this.db.connect();

    try {
      await client.query("BEGIN");

      const slug = this.ensureSlug(input.slug ?? input.name, "category");
      const id = createStableId("cat", slug);

      await client.query(
        `
          INSERT INTO categories (id, slug, name, description, sort_order, is_active, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, now(), now())
        `,
        [
          id,
          slug,
          input.name.trim(),
          input.description ?? null,
          input.sortOrder,
          input.isActive,
        ],
      );

      await client.query("COMMIT");
      return {
        data: {
          category: await this.getCategoryAdminView(id),
        },
      };
    } catch (error) {
      await client.query("ROLLBACK");
      if (isPgErrorCode(error, "23505")) {
        throw new HttpError(
          409,
          "CATEGORY_SLUG_CONFLICT",
          "A category with that slug already exists.",
        );
      }

      throw error;
    } finally {
      client.release();
    }
  }

  async replaceCategory(
    categoryIdOrSlug: string,
    input: CategoryMutationInput,
  ) {
    return this.updateCategory(categoryIdOrSlug, input, true);
  }

  async patchCategory(
    categoryIdOrSlug: string,
    input: Partial<CategoryMutationInput>,
  ) {
    return this.updateCategory(categoryIdOrSlug, input, false);
  }

  async deleteCategory(categoryIdOrSlug: string) {
    const category = await this.requireCategory(categoryIdOrSlug);

    await this.db.query(
      `
        UPDATE categories
        SET is_active = false, updated_at = now()
        WHERE id = $1
      `,
      [category.id],
    );

    return {
      data: {
        deleted: true,
        category: await this.getCategoryAdminView(category.id),
      },
    };
  }

  async createTopic(input: TopicMutationInput) {
    const client = await this.db.connect();

    try {
      await client.query("BEGIN");

      const category = await this.requireCategory(input.category, client);
      const slug = this.ensureSlug(input.slug ?? input.name, "topic");
      const id = createStableId("topic", `${category.id}:${slug}`);

      await client.query(
        `
          INSERT INTO topics (id, category_id, slug, name, description, is_active, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, now(), now())
        `,
        [
          id,
          category.id,
          slug,
          input.name.trim(),
          input.description ?? null,
          input.isActive,
        ],
      );

      await client.query("COMMIT");
      return {
        data: {
          topic: await this.getTopicAdminView(id),
        },
      };
    } catch (error) {
      await client.query("ROLLBACK");
      if (isPgErrorCode(error, "23505")) {
        throw new HttpError(
          409,
          "TOPIC_SLUG_CONFLICT",
          "A topic with that slug already exists inside the selected category.",
        );
      }

      throw error;
    } finally {
      client.release();
    }
  }

  async replaceTopic(topicIdOrSlug: string, input: TopicMutationInput) {
    return this.updateTopic(topicIdOrSlug, input, true);
  }

  async patchTopic(topicIdOrSlug: string, input: Partial<TopicMutationInput>) {
    return this.updateTopic(topicIdOrSlug, input, false);
  }

  async deleteTopic(topicIdOrSlug: string) {
    const topic = await this.requireTopic(topicIdOrSlug);

    await this.db.query(
      `
        UPDATE topics
        SET is_active = false, updated_at = now()
        WHERE id = $1
      `,
      [topic.id],
    );

    return {
      data: {
        deleted: true,
        topic: await this.getTopicAdminView(topic.id),
      },
    };
  }

  private async updateCategory(
    categoryIdOrSlug: string,
    input: Partial<CategoryMutationInput>,
    replace: boolean,
  ) {
    const existing = await this.requireCategory(categoryIdOrSlug);

    const nextName = (
      replace ? input.name : (input.name ?? existing.name)
    )?.trim();
    if (!nextName) {
      throw new HttpError(
        400,
        "INVALID_CATEGORY_NAME",
        "Category name is required.",
      );
    }

    const nextSortOrder = replace
      ? input.sortOrder
      : (input.sortOrder ?? existing.sort_order);
    if (nextSortOrder === undefined) {
      throw new HttpError(
        400,
        "INVALID_CATEGORY_SORT_ORDER",
        "Category sort order is required.",
      );
    }

    const nextIsActive = replace
      ? input.isActive
      : (input.isActive ?? existing.is_active);
    if (nextIsActive === undefined) {
      throw new HttpError(
        400,
        "INVALID_CATEGORY_STATE",
        "Category active state is required.",
      );
    }

    const nextSlug = this.ensureSlug(input.slug ?? nextName, "category");

    try {
      await this.db.query(
        `
          UPDATE categories
          SET
            slug = $2,
            name = $3,
            description = $4,
            sort_order = $5,
            is_active = $6,
            updated_at = now()
          WHERE id = $1
        `,
        [
          existing.id,
          nextSlug,
          nextName,
          replace
            ? (input.description ?? null)
            : (input.description ?? existing.description),
          nextSortOrder,
          nextIsActive,
        ],
      );
    } catch (error) {
      if (isPgErrorCode(error, "23505")) {
        throw new HttpError(
          409,
          "CATEGORY_SLUG_CONFLICT",
          "A category with that slug already exists.",
        );
      }

      throw error;
    }

    return {
      data: {
        category: await this.getCategoryAdminView(existing.id),
      },
    };
  }

  private async updateTopic(
    topicIdOrSlug: string,
    input: Partial<TopicMutationInput>,
    replace: boolean,
  ) {
    const client = await this.db.connect();

    try {
      await client.query("BEGIN");

      const existing = await this.requireTopic(topicIdOrSlug, client);
      const nextCategory = input.category
        ? await this.requireCategory(input.category, client)
        : await this.requireCategory(existing.category_id, client);
      const nextName = (
        replace ? input.name : (input.name ?? existing.name)
      )?.trim();
      if (!nextName) {
        throw new HttpError(
          400,
          "INVALID_TOPIC_NAME",
          "Topic name is required.",
        );
      }

      const nextIsActive = replace
        ? input.isActive
        : (input.isActive ?? existing.is_active);
      if (nextIsActive === undefined) {
        throw new HttpError(
          400,
          "INVALID_TOPIC_STATE",
          "Topic active state is required.",
        );
      }

      const nextSlug = this.ensureSlug(input.slug ?? nextName, "topic");

      await client.query(
        `
          UPDATE topics
          SET
            category_id = $2,
            slug = $3,
            name = $4,
            description = $5,
            is_active = $6,
            updated_at = now()
          WHERE id = $1
        `,
        [
          existing.id,
          nextCategory.id,
          nextSlug,
          nextName,
          replace
            ? (input.description ?? null)
            : (input.description ?? existing.description),
          nextIsActive,
        ],
      );

      await client.query("COMMIT");
      return {
        data: {
          topic: await this.getTopicAdminView(existing.id),
        },
      };
    } catch (error) {
      await client.query("ROLLBACK");
      if (isPgErrorCode(error, "23505")) {
        throw new HttpError(
          409,
          "TOPIC_SLUG_CONFLICT",
          "A topic with that slug already exists inside the selected category.",
        );
      }

      throw error;
    } finally {
      client.release();
    }
  }

  private async requireCategory(
    categoryIdOrSlug: string,
    db: AppDatabase | PoolClient = this.db,
  ) {
    const category = await queryOne<{
      id: string;
      slug: string;
      name: string;
      description: string | null;
      sort_order: number;
      is_active: boolean;
    }>(
      db,
      `
        SELECT id, slug, name, description, sort_order, is_active
        FROM categories
        WHERE id = $1 OR slug = $2
        LIMIT 1
      `,
      [categoryIdOrSlug, categoryIdOrSlug],
    );

    if (!category) {
      throw new HttpError(
        404,
        "CATEGORY_NOT_FOUND",
        `Category '${categoryIdOrSlug}' was not found.`,
      );
    }

    return category;
  }

  private async requireTopic(
    topicIdOrSlug: string,
    db: AppDatabase | PoolClient = this.db,
  ) {
    const topic = await queryOne<{
      id: string;
      category_id: string;
      slug: string;
      name: string;
      description: string | null;
      is_active: boolean;
    }>(
      db,
      `
        SELECT id, category_id, slug, name, description, is_active
        FROM topics
        WHERE id = $1 OR slug = $2
        LIMIT 1
      `,
      [topicIdOrSlug, topicIdOrSlug],
    );

    if (!topic) {
      throw new HttpError(
        404,
        "TOPIC_NOT_FOUND",
        `Topic '${topicIdOrSlug}' was not found.`,
      );
    }

    return topic;
  }

  private async getCategoryAdminView(categoryId: string) {
    const row = await queryOne<CategoryAdminRow>(
      this.db,
      `
        SELECT
          c.id,
          c.slug,
          c.name,
          c.description,
          c.sort_order,
          c.is_active,
          COUNT(DISTINCT m.id) AS market_count,
          COUNT(DISTINCT CASE WHEN (${effectiveMarketStatusSql("m")}) IN ('open', 'upcoming', 'resolving') THEN m.id END) AS active_market_count
        FROM categories c
        LEFT JOIN markets m ON m.category_id = c.id
        WHERE c.id = $1
        GROUP BY c.id
      `,
      [categoryId],
    );

    if (!row) {
      throw new HttpError(
        404,
        "CATEGORY_NOT_FOUND",
        `Category '${categoryId}' was not found.`,
      );
    }

    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      sort_order: Number(row.sort_order),
      is_active: Boolean(row.is_active),
      market_count: Number(row.market_count),
      active_market_count: Number(row.active_market_count),
    };
  }

  private async getTopicAdminView(topicId: string) {
    const row = await queryOne<TopicAdminRow>(
      this.db,
      `
        SELECT
          t.id,
          t.slug,
          t.name,
          t.description,
          t.is_active,
          c.id AS category_id,
          c.slug AS category_slug,
          c.name AS category_name,
          COUNT(DISTINCT mt.market_id) AS market_count,
          COUNT(DISTINCT CASE WHEN (${effectiveMarketStatusSql("m")}) IN ('open', 'upcoming', 'resolving') THEN mt.market_id END) AS active_market_count
        FROM topics t
        JOIN categories c ON c.id = t.category_id
        LEFT JOIN market_topics mt ON mt.topic_id = t.id
        LEFT JOIN markets m ON m.id = mt.market_id
        WHERE t.id = $1
        GROUP BY t.id, c.id
      `,
      [topicId],
    );

    if (!row) {
      throw new HttpError(
        404,
        "TOPIC_NOT_FOUND",
        `Topic '${topicId}' was not found.`,
      );
    }

    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      is_active: Boolean(row.is_active),
      category: {
        id: row.category_id,
        slug: row.category_slug,
        name: row.category_name,
      },
      market_count: Number(row.market_count),
      active_market_count: Number(row.active_market_count),
    };
  }

  private ensureSlug(value: string, entityName: string) {
    const slug = slugify(value);
    if (!slug) {
      throw new HttpError(
        400,
        "INVALID_SLUG",
        `A valid ${entityName} slug could not be generated.`,
      );
    }

    return slug;
  }
}
