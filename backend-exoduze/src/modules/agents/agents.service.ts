import type { PoolClient } from "pg";

import type { AppDatabase } from "../../db/database.js";
import { queryOne, queryRows } from "../../db/query.js";
import { createStableId, slugify } from "../../lib/ids.js";
import { HttpError, isPgErrorCode } from "../../lib/http-error.js";
import type { RequestAuth } from "../auth/auth.types.js";
import { effectiveMarketStatusSql } from "../markets/market-status.js";

type ListAgentsQuery = {
  ownerWallet?: string | undefined;
  category?: string | undefined;
  status?: string | undefined;
  sort: "top_rank" | "newest" | "name";
  limit: number;
};

type HallOfFameQuery = {
  window: "all_time";
  limit: number;
};

type OwnerAgentsQuery = Omit<ListAgentsQuery, "ownerWallet">;

type AgentCategory = {
  slug: string;
  name: string;
  is_primary: boolean;
};

type AgentBaseRow = {
  id: string;
  slug: string;
  name: string;
  description: string;
  status: string;
  avatar_uri: string | null;
  created_at: string;
  owner_wallet_address: string | null;
  owner_is_active: boolean | null;
  latest_version_id: string | null;
  latest_version_label: string | null;
  latest_version_no: number | null;
  latest_model_provider: string | null;
  latest_model_name: string | null;
  latest_version_created_at: string | null;
  leaderboard_window: string | null;
  leaderboard_rank: number | null;
  resolved_markets: number | null;
  wins: number | null;
  losses: number | null;
  accuracy_pct: string | null;
  bayesian_accuracy: string | null;
  current_streak: number | null;
  best_streak: number | null;
  total_staked_usdc: string | null;
  follower_pnl_usdc: string | null;
  active_markets_count: string | number;
};

type HallOfFameRow = {
  id: string;
  slug: string;
  name: string;
  description: string;
  status: string;
  avatar_uri: string | null;
  owner_wallet_address: string | null;
  rank: number;
  resolved_markets: number;
  wins: number;
  losses: number;
  accuracy_pct: string;
  bayesian_accuracy: string;
  current_streak: number;
  best_streak: number;
  total_staked_usdc: string;
  follower_pnl_usdc: string;
  window_start: string;
  window_end: string;
  active_markets_count: string | number;
};

type AgentCategoryRow = {
  agent_id: string;
  slug: string;
  name: string;
  is_primary: boolean;
};

type OwnerCategoryRow = {
  wallet_identity_id: string;
  slug: string;
  name: string;
  is_primary: boolean;
};

type OwnerSummaryRow = {
  wallet_identity_id: string;
  wallet_address: string;
  is_active: boolean;
  created_at: string;
  agent_count: string | number;
  active_agents_count: string | number;
  ranked_agents_count: string | number;
  best_rank: number | null;
  resolved_markets: string | number;
  total_staked_usdc: string;
  follower_pnl_usdc: string;
  top_agent_id: string | null;
  top_agent_slug: string | null;
  top_agent_name: string | null;
  top_agent_avatar_uri: string | null;
  top_agent_rank: number | null;
};

type AgentMutationInput = {
  ownerWallet?: string | undefined;
  slug?: string | undefined;
  name: string;
  description: string;
  status: string;
  avatarUri?: string | null | undefined;
  categorySlugs: string[];
};

type ManagedAgentRecord = {
  id: string;
  slug: string;
  name: string;
  description: string;
  status: string;
  avatar_uri: string | null;
  owner_wallet_identity_id: string | null;
  owner_wallet_address: string | null;
};

export class AgentsService {
  constructor(private readonly db: AppDatabase) {}

  async listAgents(query: ListAgentsQuery) {
    const params: unknown[] = [];
    const where: string[] = [];

    if (query.ownerWallet) {
      where.push(`w.wallet_address = $${params.length + 1}`);
      params.push(query.ownerWallet);
    }

    if (query.status) {
      where.push(`a.status = $${params.length + 1}`);
      params.push(query.status);
    }

    if (query.category) {
      where.push(
        `
          EXISTS (
            SELECT 1
            FROM agent_categories acf
            JOIN categories cf ON cf.id = acf.category_id
            WHERE acf.agent_id = a.id AND cf.slug = $${params.length + 1}
          )
        `
      );
      params.push(query.category);
    }

    const rows = await this.fetchAgentBaseRows(where.length > 0 ? where.join(" AND ") : null, params);

    const sorted = [...rows].sort((left, right) => {
      if (query.sort === "name") {
        return left.name.localeCompare(right.name);
      }

      if (query.sort === "newest") {
        return Date.parse(right.created_at) - Date.parse(left.created_at);
      }

      const leftRank = left.leaderboard_rank ?? Number.MAX_SAFE_INTEGER;
      const rightRank = right.leaderboard_rank ?? Number.MAX_SAFE_INTEGER;
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }

      return left.name.localeCompare(right.name);
    });

    const sliced = sorted.slice(0, query.limit);
    const categoriesMap = await this.getAgentCategoriesMap(sliced.map((row) => row.id));
    const agents = sliced.map((row) => this.mapAgentRow(row, categoriesMap.get(row.id) ?? []));
    const ownerCount = new Set(
      rows
        .map((row) => row.owner_wallet_address)
        .filter((walletAddress): walletAddress is string => Boolean(walletAddress))
    ).size;

    return {
      data: {
        summary: {
          total_agents: rows.length,
          active_agents: rows.filter((row) => row.status === "active").length,
          ranked_agents: rows.filter((row) => row.leaderboard_rank !== null).length,
          owner_count: ownerCount
        },
        filters: {
          owner_wallet: query.ownerWallet ?? null,
          category: query.category ?? null,
          status: query.status ?? null,
          sort: query.sort
        },
        page_info: {
          limit: query.limit,
          returned_count: agents.length,
          total_count: rows.length,
          has_more: rows.length > agents.length
        },
        agents
      }
    };
  }

  async getHallOfFame(query: HallOfFameQuery) {
    const latestWindow = await queryOne<{ latest_window_end: string | null }>(
      this.db,
      `
        SELECT MAX(window_end)::text AS latest_window_end
        FROM leaderboard_agent_snapshots
        WHERE window_type = $1
      `,
      [query.window]
    );

    const latestWindowEnd = latestWindow?.latest_window_end ?? null;
    if (!latestWindowEnd) {
      return {
        data: {
          window: query.window,
          generated_at: null,
          window_range: null,
          summary: {
            total_ranked_agents: 0
          },
          podium: [],
          page_info: {
            limit: query.limit,
            returned_count: 0,
            total_count: 0,
            has_more: false
          },
          agents: []
        }
      };
    }

    const totalRanked = await queryOne<{ count: string }>(
      this.db,
      `
        SELECT COUNT(*)::text AS count
        FROM leaderboard_agent_snapshots
        WHERE window_type = $1
          AND window_end::text = $2
      `,
      [query.window, latestWindowEnd]
    );

    const rows = await queryRows<HallOfFameRow>(
      this.db,
      `
        SELECT
          a.id,
          a.slug,
          a.name,
          a.description,
          a.status,
          a.avatar_uri,
          w.wallet_address AS owner_wallet_address,
          las.rank,
          las.resolved_markets,
          las.wins,
          las.losses,
          las.accuracy_pct::text,
          las.bayesian_accuracy::text,
          las.current_streak,
          las.best_streak,
          las.total_staked_usdc::text,
          las.follower_pnl_usdc::text,
          las.window_start::text,
          las.window_end::text,
          (
            SELECT COUNT(*)
            FROM market_agents ma
            JOIN markets m ON m.id = ma.market_id
            WHERE ma.agent_id = a.id
              AND (${effectiveMarketStatusSql("m")}) IN ('open', 'upcoming', 'resolving')
          ) AS active_markets_count
        FROM leaderboard_agent_snapshots las
        JOIN agents a ON a.id = las.agent_id
        LEFT JOIN wallet_identities w ON w.id = a.owner_wallet_identity_id
        WHERE las.window_type = $1
          AND las.window_end::text = $2
        ORDER BY las.rank ASC
        LIMIT $3
      `,
      [query.window, latestWindowEnd, query.limit]
    );

    const categoriesMap = await this.getAgentCategoriesMap(rows.map((row) => row.id));
    const agents = rows.map((row) => ({
      rank: Number(row.rank),
      agent: {
        id: row.id,
        slug: row.slug,
        name: row.name,
        description: row.description,
        status: row.status,
        avatar_uri: row.avatar_uri,
        owner: row.owner_wallet_address
          ? {
              wallet_address: row.owner_wallet_address
            }
          : null,
        categories: categoriesMap.get(row.id) ?? [],
        activity: {
          active_markets_count: Number(row.active_markets_count)
        }
      },
      stats: {
        resolved_markets: Number(row.resolved_markets),
        wins: Number(row.wins),
        losses: Number(row.losses),
        accuracy_pct: row.accuracy_pct,
        bayesian_accuracy: row.bayesian_accuracy,
        current_streak: Number(row.current_streak),
        best_streak: Number(row.best_streak),
        total_staked_usdc: row.total_staked_usdc,
        follower_pnl_usdc: row.follower_pnl_usdc
      },
      window: {
        type: query.window,
        start: row.window_start,
        end: row.window_end
      }
    }));

    return {
      data: {
        window: query.window,
        generated_at: latestWindowEnd,
        window_range: rows[0]
          ? {
              start: rows[0].window_start,
              end: rows[0].window_end
            }
          : null,
        summary: {
          total_ranked_agents: Number(totalRanked?.count ?? 0)
        },
        podium: agents.slice(0, 3),
        page_info: {
          limit: query.limit,
          returned_count: agents.length,
          total_count: Number(totalRanked?.count ?? 0),
          has_more: Number(totalRanked?.count ?? 0) > agents.length
        },
        agents
      }
    };
  }

  async listOwners() {
    const rows = await queryRows<OwnerSummaryRow>(
      this.db,
      `
        WITH latest_snapshots AS (
          SELECT DISTINCT ON (agent_id)
            agent_id,
            rank,
            resolved_markets,
            total_staked_usdc,
            follower_pnl_usdc
          FROM leaderboard_agent_snapshots
          WHERE window_type = 'all_time'
          ORDER BY agent_id, window_end DESC
        ),
        top_agents AS (
          SELECT DISTINCT ON (a.owner_wallet_identity_id)
            a.owner_wallet_identity_id,
            a.id AS top_agent_id,
            a.slug AS top_agent_slug,
            a.name AS top_agent_name,
            a.avatar_uri AS top_agent_avatar_uri,
            ls.rank AS top_agent_rank
          FROM agents a
          LEFT JOIN latest_snapshots ls ON ls.agent_id = a.id
          WHERE a.owner_wallet_identity_id IS NOT NULL
          ORDER BY a.owner_wallet_identity_id, ls.rank ASC NULLS LAST, a.name ASC
        )
        SELECT
          w.id AS wallet_identity_id,
          w.wallet_address,
          w.is_active,
          w.created_at::text,
          COUNT(a.id) AS agent_count,
          COUNT(*) FILTER (WHERE a.status = 'active') AS active_agents_count,
          COUNT(ls.agent_id) AS ranked_agents_count,
          MIN(ls.rank) AS best_rank,
          COALESCE(SUM(ls.resolved_markets), 0) AS resolved_markets,
          COALESCE(SUM(ls.total_staked_usdc), 0)::text AS total_staked_usdc,
          COALESCE(SUM(ls.follower_pnl_usdc), 0)::text AS follower_pnl_usdc,
          ta.top_agent_id,
          ta.top_agent_slug,
          ta.top_agent_name,
          ta.top_agent_avatar_uri,
          ta.top_agent_rank
        FROM wallet_identities w
        JOIN agents a ON a.owner_wallet_identity_id = w.id
        LEFT JOIN latest_snapshots ls ON ls.agent_id = a.id
        LEFT JOIN top_agents ta ON ta.owner_wallet_identity_id = w.id
        GROUP BY
          w.id,
          ta.top_agent_id,
          ta.top_agent_slug,
          ta.top_agent_name,
          ta.top_agent_avatar_uri,
          ta.top_agent_rank
        ORDER BY COUNT(a.id) DESC, MIN(ls.rank) ASC NULLS LAST, w.wallet_address ASC
      `
    );

    const categoriesMap = await this.getOwnerCategoriesMap(rows.map((row) => row.wallet_identity_id));
    const owners = rows.map((row) => this.mapOwnerRow(row, categoriesMap.get(row.wallet_identity_id) ?? []));

    return {
      data: {
        summary: {
          total_owners: owners.length,
          active_owners: owners.filter((owner) => owner.is_active).length,
          total_agents: owners.reduce((total, owner) => total + owner.agent_count, 0),
          total_active_agents: owners.reduce((total, owner) => total + owner.active_agents_count, 0)
        },
        owners
      }
    };
  }

  async getOwnerProfile(walletAddress: string) {
    const row = await queryOne<OwnerSummaryRow>(
      this.db,
      `
        WITH latest_snapshots AS (
          SELECT DISTINCT ON (agent_id)
            agent_id,
            rank,
            resolved_markets,
            total_staked_usdc,
            follower_pnl_usdc
          FROM leaderboard_agent_snapshots
          WHERE window_type = 'all_time'
          ORDER BY agent_id, window_end DESC
        ),
        top_agent AS (
          SELECT
            a.id AS top_agent_id,
            a.slug AS top_agent_slug,
            a.name AS top_agent_name,
            a.avatar_uri AS top_agent_avatar_uri,
            ls.rank AS top_agent_rank
          FROM agents a
          LEFT JOIN latest_snapshots ls ON ls.agent_id = a.id
          JOIN wallet_identities w ON w.id = a.owner_wallet_identity_id
          WHERE w.wallet_address = $1
          ORDER BY ls.rank ASC NULLS LAST, a.name ASC
          LIMIT 1
        )
        SELECT
          w.id AS wallet_identity_id,
          w.wallet_address,
          w.is_active,
          w.created_at::text,
          COUNT(a.id) AS agent_count,
          COUNT(*) FILTER (WHERE a.status = 'active') AS active_agents_count,
          COUNT(ls.agent_id) AS ranked_agents_count,
          MIN(ls.rank) AS best_rank,
          COALESCE(SUM(ls.resolved_markets), 0) AS resolved_markets,
          COALESCE(SUM(ls.total_staked_usdc), 0)::text AS total_staked_usdc,
          COALESCE(SUM(ls.follower_pnl_usdc), 0)::text AS follower_pnl_usdc,
          ta.top_agent_id,
          ta.top_agent_slug,
          ta.top_agent_name,
          ta.top_agent_avatar_uri,
          ta.top_agent_rank
        FROM wallet_identities w
        LEFT JOIN agents a ON a.owner_wallet_identity_id = w.id
        LEFT JOIN latest_snapshots ls ON ls.agent_id = a.id
        LEFT JOIN top_agent ta ON true
        WHERE w.wallet_address = $1
        GROUP BY
          w.id,
          ta.top_agent_id,
          ta.top_agent_slug,
          ta.top_agent_name,
          ta.top_agent_avatar_uri,
          ta.top_agent_rank
      `,
      [walletAddress]
    );

    if (!row || Number(row.agent_count) === 0) {
      return null;
    }

    const categoriesMap = await this.getOwnerCategoriesMap([row.wallet_identity_id]);
    const owner = this.mapOwnerRow(row, categoriesMap.get(row.wallet_identity_id) ?? []);

    return {
      data: {
        owner
      }
    };
  }

  async listOwnerAgents(walletAddress: string, query: OwnerAgentsQuery) {
    const ownerProfile = await this.getOwnerProfile(walletAddress);
    if (!ownerProfile) {
      return null;
    }

    const result = await this.listAgents({
      ...query,
      ownerWallet: walletAddress
    });

    return {
      data: {
        owner: ownerProfile.data.owner,
        summary: result.data.summary,
        filters: result.data.filters,
        page_info: result.data.page_info,
        agents: result.data.agents
      }
    };
  }

  async createAgent(actor: RequestAuth, input: AgentMutationInput) {
    const client = await this.db.connect();

    try {
      await client.query("BEGIN");

      const ownerWallet = this.resolveTargetOwnerWallet(actor, input.ownerWallet);
      const ownerIdentity = await this.ensureWalletIdentity(ownerWallet, client);
      const slug = this.ensureAgentSlug(input.slug ?? input.name);
      const id = createStableId("agt", `${ownerWallet}:${slug}`);
      const categoryRows = await this.requireAgentCategories(input.categorySlugs, client);

      await client.query(
        `
          INSERT INTO agents (
            id,
            slug,
            name,
            description,
            owner_wallet_identity_id,
            status,
            avatar_uri,
            created_at,
            updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, now(), now()
          )
        `,
        [
          id,
          slug,
          input.name.trim(),
          input.description.trim(),
          ownerIdentity.id,
          input.status,
          input.avatarUri ?? null
        ]
      );

      await this.syncAgentCategories(client, id, categoryRows);
      await client.query("COMMIT");

      return {
        data: {
          agent: await this.requireAgentView(id)
        }
      };
    } catch (error) {
      await client.query("ROLLBACK");
      if (isPgErrorCode(error, "23505")) {
        throw new HttpError(409, "AGENT_SLUG_CONFLICT", "An agent with that slug already exists.");
      }

      throw error;
    } finally {
      client.release();
    }
  }

  async replaceAgent(actor: RequestAuth, agentIdOrSlug: string, input: AgentMutationInput) {
    return this.updateAgent(actor, agentIdOrSlug, input, true);
  }

  async patchAgent(actor: RequestAuth, agentIdOrSlug: string, input: Partial<AgentMutationInput>) {
    return this.updateAgent(actor, agentIdOrSlug, input, false);
  }

  async deleteAgent(actor: RequestAuth, agentIdOrSlug: string) {
    const existing = await this.requireManagedAgent(agentIdOrSlug);
    this.assertCanManageAgent(existing, actor);

    await this.db.query(
      `
        UPDATE agents
        SET status = 'inactive', updated_at = now()
        WHERE id = $1
      `,
      [existing.id]
    );

    return {
      data: {
        deleted: true,
        agent: await this.requireAgentView(existing.id)
      }
    };
  }

  private mapAgentRow(row: AgentBaseRow, categories: AgentCategory[]) {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      status: row.status,
      avatar_uri: row.avatar_uri,
      owner: row.owner_wallet_address
        ? {
            wallet_address: row.owner_wallet_address,
            is_active: Boolean(row.owner_is_active)
          }
        : null,
      categories,
      latest_version: row.latest_version_id
        ? {
            id: row.latest_version_id,
            version_label: row.latest_version_label,
            version_no: row.latest_version_no,
            model_provider: row.latest_model_provider,
            model_name: row.latest_model_name,
            created_at: row.latest_version_created_at
          }
        : null,
      stats: row.leaderboard_rank === null
        ? null
        : {
            window: row.leaderboard_window,
            rank: Number(row.leaderboard_rank),
            resolved_markets: Number(row.resolved_markets ?? 0),
            wins: Number(row.wins ?? 0),
            losses: Number(row.losses ?? 0),
            accuracy_pct: row.accuracy_pct,
            bayesian_accuracy: row.bayesian_accuracy,
            current_streak: Number(row.current_streak ?? 0),
            best_streak: Number(row.best_streak ?? 0),
            total_staked_usdc: row.total_staked_usdc,
            follower_pnl_usdc: row.follower_pnl_usdc
          },
      activity: {
        active_markets_count: Number(row.active_markets_count)
      },
      badges: {
        is_ranked: row.leaderboard_rank !== null,
        has_live_market: Number(row.active_markets_count) > 0
      },
      active_markets_count: Number(row.active_markets_count)
    };
  }

  private mapOwnerRow(row: OwnerSummaryRow, categories: AgentCategory[]) {
    return {
      wallet_identity_id: row.wallet_identity_id,
      wallet_address: row.wallet_address,
      is_active: Boolean(row.is_active),
      created_at: row.created_at,
      categories,
      agent_count: Number(row.agent_count),
      active_agents_count: Number(row.active_agents_count),
      best_rank: row.best_rank === null ? null : Number(row.best_rank),
      stats: {
        agent_count: Number(row.agent_count),
        active_agents_count: Number(row.active_agents_count),
        ranked_agents_count: Number(row.ranked_agents_count),
        best_rank: row.best_rank === null ? null : Number(row.best_rank),
        resolved_markets: Number(row.resolved_markets),
        total_staked_usdc: row.total_staked_usdc,
        follower_pnl_usdc: row.follower_pnl_usdc
      },
      top_agent: row.top_agent_id
        ? {
            id: row.top_agent_id,
            slug: row.top_agent_slug,
            name: row.top_agent_name,
            avatar_uri: row.top_agent_avatar_uri,
            rank: row.top_agent_rank === null ? null : Number(row.top_agent_rank)
          }
        : null
    };
  }

  private async updateAgent(
    actor: RequestAuth,
    agentIdOrSlug: string,
    input: Partial<AgentMutationInput>,
    replace: boolean
  ) {
    const client = await this.db.connect();

    try {
      await client.query("BEGIN");

      const existing = await this.requireManagedAgent(agentIdOrSlug, client);
      this.assertCanManageAgent(existing, actor);

      const ownerWallet = this.resolveTargetOwnerWallet(
        actor,
        Object.prototype.hasOwnProperty.call(input, "ownerWallet") ? input.ownerWallet : existing.owner_wallet_address ?? undefined
      );
      const ownerIdentity = await this.ensureWalletIdentity(ownerWallet, client);
      const categorySlugs =
        replace ? input.categorySlugs : input.categorySlugs ?? (await this.getAgentCategorySlugs(existing.id, client));

      if (!categorySlugs) {
        throw new HttpError(400, "AGENT_CATEGORIES_REQUIRED", "category_slugs is required for this request.");
      }

      const categoryRows = await this.requireAgentCategories(categorySlugs, client);
      const name = (replace ? input.name : input.name ?? existing.name)?.trim();
      const description = (replace ? input.description : input.description ?? existing.description)?.trim();
      const status = replace ? input.status : input.status ?? existing.status;

      if (!name || !description || !status) {
        throw new HttpError(400, "INVALID_AGENT_PAYLOAD", "Required agent fields are missing.");
      }

      const slug = replace
        ? this.ensureAgentSlug(input.slug ?? name)
        : input.slug
          ? this.ensureAgentSlug(input.slug)
          : existing.slug;
      const avatarUri = replace
        ? input.avatarUri ?? null
        : Object.prototype.hasOwnProperty.call(input, "avatarUri")
          ? input.avatarUri ?? null
          : existing.avatar_uri;

      await client.query(
        `
          UPDATE agents
          SET
            slug = $2,
            name = $3,
            description = $4,
            owner_wallet_identity_id = $5,
            status = $6,
            avatar_uri = $7,
            updated_at = now()
          WHERE id = $1
        `,
        [existing.id, slug, name, description, ownerIdentity.id, status, avatarUri]
      );

      await this.syncAgentCategories(client, existing.id, categoryRows);
      await client.query("COMMIT");

      return {
        data: {
          agent: await this.requireAgentView(existing.id)
        }
      };
    } catch (error) {
      await client.query("ROLLBACK");
      if (isPgErrorCode(error, "23505")) {
        throw new HttpError(409, "AGENT_SLUG_CONFLICT", "An agent with that slug already exists.");
      }

      throw error;
    } finally {
      client.release();
    }
  }

  private async getAgentCategoriesMap(agentIds: string[]) {
    const uniqueAgentIds = [...new Set(agentIds)];
    if (uniqueAgentIds.length === 0) {
      return new Map<string, AgentCategory[]>();
    }

    const placeholders = uniqueAgentIds.map((_, index) => `$${index + 1}`).join(", ");
    const categories = await queryRows<AgentCategoryRow>(
      this.db,
      `
        SELECT ac.agent_id, c.slug, c.name, ac.is_primary
        FROM agent_categories ac
        JOIN categories c ON c.id = ac.category_id
        WHERE ac.agent_id IN (${placeholders})
        ORDER BY ac.agent_id ASC, ac.is_primary DESC, c.name ASC
      `,
      uniqueAgentIds
    );

    const categoriesMap = new Map<string, AgentCategory[]>();
    for (const category of categories) {
      const group = categoriesMap.get(category.agent_id) ?? [];
      group.push({
        slug: category.slug,
        name: category.name,
        is_primary: Boolean(category.is_primary)
      });
      categoriesMap.set(category.agent_id, group);
    }

    return categoriesMap;
  }

  private async getOwnerCategoriesMap(ownerIds: string[]) {
    const uniqueOwnerIds = [...new Set(ownerIds)];
    if (uniqueOwnerIds.length === 0) {
      return new Map<string, AgentCategory[]>();
    }

    const placeholders = uniqueOwnerIds.map((_, index) => `$${index + 1}`).join(", ");
    const categories = await queryRows<OwnerCategoryRow>(
      this.db,
      `
        SELECT
          a.owner_wallet_identity_id AS wallet_identity_id,
          c.slug,
          c.name,
          BOOL_OR(ac.is_primary) AS is_primary
        FROM agents a
        JOIN agent_categories ac ON ac.agent_id = a.id
        JOIN categories c ON c.id = ac.category_id
        WHERE a.owner_wallet_identity_id IN (${placeholders})
        GROUP BY a.owner_wallet_identity_id, c.id, c.slug, c.name
        ORDER BY a.owner_wallet_identity_id ASC, BOOL_OR(ac.is_primary) DESC, c.name ASC
      `,
      uniqueOwnerIds
    );

    const categoriesMap = new Map<string, AgentCategory[]>();
    for (const category of categories) {
      const group = categoriesMap.get(category.wallet_identity_id) ?? [];
      group.push({
        slug: category.slug,
        name: category.name,
        is_primary: Boolean(category.is_primary)
      });
      categoriesMap.set(category.wallet_identity_id, group);
    }

    return categoriesMap;
  }

  private async fetchAgentBaseRows(whereSql: string | null, params: unknown[] = []) {
    return queryRows<AgentBaseRow>(
      this.db,
      `
        WITH latest_versions AS (
          SELECT DISTINCT ON (av.agent_id)
            av.agent_id,
            av.id AS latest_version_id,
            av.version_label AS latest_version_label,
            av.version_no AS latest_version_no,
            av.model_provider AS latest_model_provider,
            av.model_name AS latest_model_name,
            av.created_at::text AS latest_version_created_at
          FROM agent_versions av
          ORDER BY av.agent_id, av.created_at DESC
        ),
        latest_snapshots AS (
          SELECT DISTINCT ON (las.agent_id)
            las.agent_id,
            las.window_type AS leaderboard_window,
            las.rank AS leaderboard_rank,
            las.resolved_markets,
            las.wins,
            las.losses,
            las.accuracy_pct::text,
            las.bayesian_accuracy::text,
            las.current_streak,
            las.best_streak,
            las.total_staked_usdc::text,
            las.follower_pnl_usdc::text
          FROM leaderboard_agent_snapshots las
          WHERE las.window_type = 'all_time'
          ORDER BY las.agent_id, las.window_end DESC
        )
        SELECT
          a.id,
          a.slug,
          a.name,
          a.description,
          a.status,
          a.avatar_uri,
          a.created_at::text,
          w.wallet_address AS owner_wallet_address,
          w.is_active AS owner_is_active,
          lv.latest_version_id,
          lv.latest_version_label,
          lv.latest_version_no,
          lv.latest_model_provider,
          lv.latest_model_name,
          lv.latest_version_created_at,
          ls.leaderboard_window,
          ls.leaderboard_rank,
          ls.resolved_markets,
          ls.wins,
          ls.losses,
          ls.accuracy_pct,
          ls.bayesian_accuracy,
          ls.current_streak,
          ls.best_streak,
          ls.total_staked_usdc,
          ls.follower_pnl_usdc,
          (
            SELECT COUNT(*)
            FROM market_agents ma
            JOIN markets m ON m.id = ma.market_id
            WHERE ma.agent_id = a.id
              AND (${effectiveMarketStatusSql("m")}) IN ('open', 'upcoming', 'resolving')
          ) AS active_markets_count
        FROM agents a
        LEFT JOIN wallet_identities w ON w.id = a.owner_wallet_identity_id
        LEFT JOIN latest_versions lv ON lv.agent_id = a.id
        LEFT JOIN latest_snapshots ls ON ls.agent_id = a.id
        ${whereSql ? `WHERE ${whereSql}` : ""}
      `,
      params
    );
  }

  private async requireManagedAgent(agentIdOrSlug: string, db: AppDatabase | PoolClient = this.db) {
    const agent = await queryOne<ManagedAgentRecord>(
      db,
      `
        SELECT
          a.id,
          a.slug,
          a.name,
          a.description,
          a.status,
          a.avatar_uri,
          a.owner_wallet_identity_id,
          w.wallet_address AS owner_wallet_address
        FROM agents a
        LEFT JOIN wallet_identities w ON w.id = a.owner_wallet_identity_id
        WHERE a.id = $1 OR a.slug = $2
        LIMIT 1
      `,
      [agentIdOrSlug, agentIdOrSlug]
    );

    if (!agent) {
      throw new HttpError(404, "AGENT_NOT_FOUND", `Agent '${agentIdOrSlug}' was not found.`);
    }

    return agent;
  }

  private async requireAgentView(agentIdOrSlug: string) {
    const rows = await this.fetchAgentBaseRows("(a.id = $1 OR a.slug = $2)", [agentIdOrSlug, agentIdOrSlug]);
    const row = rows[0];

    if (!row) {
      throw new HttpError(404, "AGENT_NOT_FOUND", `Agent '${agentIdOrSlug}' was not found.`);
    }

    const categoriesMap = await this.getAgentCategoriesMap([row.id]);
    return this.mapAgentRow(row, categoriesMap.get(row.id) ?? []);
  }

  private resolveTargetOwnerWallet(actor: RequestAuth, requestedWallet?: string) {
    const ownerWallet = requestedWallet?.trim() || actor.walletAddress;

    if (!actor.isAdmin && ownerWallet !== actor.walletAddress) {
      throw new HttpError(
        403,
        "AGENT_OWNER_FORBIDDEN",
        "Only the admin wallet can assign an agent to a different owner wallet."
      );
    }

    return ownerWallet;
  }

  private async ensureWalletIdentity(walletAddress: string, db: AppDatabase | PoolClient = this.db) {
    const existing = await queryOne<{ id: string; is_active: boolean }>(
      db,
      `
        SELECT id, is_active
        FROM wallet_identities
        WHERE wallet_address = $1
        LIMIT 1
      `,
      [walletAddress]
    );

    if (existing) {
      if (!existing.is_active) {
        throw new HttpError(403, "WALLET_DISABLED", "The target wallet is disabled.");
      }

      return {
        id: existing.id
      };
    }

    const walletIdentityId = createStableId("wallet", walletAddress);
    await db.query(
      `
        INSERT INTO wallet_identities (id, wallet_address, is_active, created_at, updated_at)
        VALUES ($1, $2, true, now(), now())
      `,
      [walletIdentityId, walletAddress]
    );

    return {
      id: walletIdentityId
    };
  }

  private async requireAgentCategories(categorySlugs: string[], db: AppDatabase | PoolClient = this.db) {
    const normalizedSlugs = [...new Set(categorySlugs.map((slug) => slugify(slug)).filter(Boolean))];
    if (normalizedSlugs.length === 0) {
      throw new HttpError(400, "AGENT_CATEGORIES_REQUIRED", "At least one valid category slug is required.");
    }

    const rows = await queryRows<{ id: string; slug: string }>(
      db,
      `
        SELECT id, slug
        FROM categories
        WHERE is_active = true
          AND slug = ANY($1::text[])
      `,
      [normalizedSlugs]
    );

    if (rows.length !== normalizedSlugs.length) {
      const foundSlugs = new Set(rows.map((row) => row.slug));
      const missing = normalizedSlugs.filter((slug) => !foundSlugs.has(slug));
      throw new HttpError(
        400,
        "AGENT_CATEGORIES_INVALID",
        `The following categories are invalid: ${missing.join(", ")}.`
      );
    }

    const rowsBySlug = new Map(rows.map((row) => [row.slug, row]));
    return normalizedSlugs.map((slug) => rowsBySlug.get(slug)).filter((row): row is { id: string; slug: string } => Boolean(row));
  }

  private async syncAgentCategories(
    client: PoolClient,
    agentId: string,
    categories: Array<{ id: string; slug: string }>
  ) {
    await client.query("DELETE FROM agent_categories WHERE agent_id = $1", [agentId]);

    for (const [index, category] of categories.entries()) {
      await client.query(
        `
          INSERT INTO agent_categories (id, agent_id, category_id, is_primary, created_at, updated_at)
          VALUES ($1, $2, $3, $4, now(), now())
        `,
        [createStableId("ac", `${agentId}:${category.id}`), agentId, category.id, index === 0]
      );
    }
  }

  private async getAgentCategorySlugs(agentId: string, db: AppDatabase | PoolClient = this.db) {
    const rows = await queryRows<{ slug: string }>(
      db,
      `
        SELECT c.slug
        FROM agent_categories ac
        JOIN categories c ON c.id = ac.category_id
        WHERE ac.agent_id = $1
        ORDER BY ac.is_primary DESC, c.name ASC
      `,
      [agentId]
    );

    return rows.map((row) => row.slug);
  }

  private assertCanManageAgent(agent: ManagedAgentRecord, actor: RequestAuth) {
    if (actor.isAdmin) {
      return;
    }

    if (agent.owner_wallet_address && agent.owner_wallet_address === actor.walletAddress) {
      return;
    }

    throw new HttpError(403, "AGENT_ACCESS_FORBIDDEN", "You can only manage agents owned by your wallet.");
  }

  private ensureAgentSlug(value: string) {
    const slug = slugify(value);
    if (!slug) {
      throw new HttpError(400, "INVALID_AGENT_SLUG", "A valid agent slug could not be generated.");
    }

    return slug;
  }
}
