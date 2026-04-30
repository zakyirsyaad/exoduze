import type { PoolClient } from "pg";

import type { Env } from "../../config/env.js";
import type { AppDatabase } from "../../db/database.js";
import { queryOne, queryRows } from "../../db/query.js";
import {
  createStableId,
  MAX_MARKET_SLUG_LENGTH,
  slugify,
} from "../../lib/ids.js";
import { HttpError, isPgErrorCode } from "../../lib/http-error.js";
import type { ExoduzeOnchainService } from "../onchain/exoduze-onchain.service.js";
import {
  marketImageLateralSql,
  usableImageExpressionSql,
} from "./market-image-sql.js";
import {
  effectiveMarketStatusSql,
  getEffectiveMarketStatus,
} from "./market-status.js";
import { buildConfiguredJoinDeadlineAt } from "./market-join-window.js";
import { hasPublishedMarketTimingChange } from "./market-onchain-timing.js";

const DECIMAL_PLACES = 12;
const DECIMAL_SCALE = 1_000_000_000_000n;
const BPS_DENOMINATOR = 10_000n;

type ListMarketsQuery = {
  category?: string | undefined;
  topic?: string | undefined;
  status?: string | undefined;
};

type MarketSummaryRow = {
  id: string;
  slug: string;
  title: string;
  short_description: string;
  image_uri: string | null;
  status: string;
  category_id: string;
  category_slug: string;
  category_name: string;
  opens_at: string;
  join_deadline_at: string;
  decision_cutoff_at: string;
  closes_at: string;
  total_liquidity_usdc: string;
};

type MarketDetailRow = {
  id: string;
  slug: string;
  title: string;
  short_description: string;
  description: string;
  image_uri: string | null;
  status: string;
  onchain_market_pubkey: string | null;
  oracle_source: string;
  opens_at: string;
  join_deadline_at: string;
  decision_cutoff_at: string;
  closes_at: string;
  resolves_at: string | null;
  final_outcome: string | null;
  total_liquidity_usdc: string;
  final_liquidity_usdc: string | null;
  category_id: string;
  category_slug: string;
  category_name: string;
  rules_json: unknown;
  context_json: unknown;
  created_by: string | null;
  created_by_wallet_address: string | null;
  resolver_wallet_address: string | null;
};

type MarketResolutionProposalRow = {
  id: string;
  proposed_outcome: string;
  evidence_snapshot_id: string;
  evidence_summary: string;
  proposed_by: string;
  proposed_at: string;
  dispute_deadline: string;
  status: string;
  finalized_outcome: string | null;
  finalized_at: string | null;
  finalized_by: string | null;
  dispute_reason: string | null;
  snapshot_generated_at: string | null;
  snapshot_category: string | null;
  snapshot_window_hours: number | string | null;
  dispute_id: string | null;
  dispute_status: string | null;
  dispute_created_at: string | null;
};

type MarketAgentSupportRow = {
  market_agent_id: string;
  follower_count: number | string;
  follower_staked_usdc: string;
};

type MarketRealtimeRevisionRow = {
  id: string;
  slug: string;
  revision_at: string;
  revision: string;
};

type BattleEntryRow = {
  id: string;
  market_agent_id: string | null;
  agent_id: string;
  agent_slug: string;
  agent_name: string;
  agent_description: string;
  agent_avatar_uri: string | null;
  agent_specialization: string;
  agent_risk_profile: string;
  strategy_preset: string;
  technical_weight: number;
  news_weight: number;
  sentiment_weight: number;
  macro_weight: number;
  onchain_weight: number;
  optional_insight: string | null;
  stake_amount: string;
  prediction_json: unknown;
  prediction_hash: string;
  status: string;
  created_at: string;
};

type BattlePoolRow = {
  direction: string | null;
  entry_count: number | string;
  total_stake_usdc: string;
};

type MarketMutationInput = {
  category: string;
  slug?: string | undefined;
  title: string;
  shortDescription: string;
  description: string;
  imageUri?: string | null | undefined;
  status: string;
  oracleSource: string;
  settlementAsset: string;
  onchainMarketPubkey?: string | null | undefined;
  opensAt: string;
  joinDeadlineAt?: string | undefined;
  decisionCutoffAt: string;
  closesAt: string;
  resolvesAt?: string | null | undefined;
  totalLiquidityUsdc: string;
  finalLiquidityUsdc?: string | null | undefined;
  topicSlugs: string[];
  resolverWallet?: string | null | undefined;
  rules?: unknown[] | undefined;
  context?: Record<string, unknown> | undefined;
};

type MarketOutcome = "YES" | "NO";

type MarketResolveInput = {
  outcome: MarketOutcome;
  evidenceUri?: string | null | undefined;
  submittedTxSig?: string | null | undefined;
  resolvedAt?: string | undefined;
  submittedByWalletId?: string | null | undefined;
};

type ManagedMarketRow = {
  id: string;
  slug: string;
  title: string;
  short_description: string;
  description: string;
  image_uri: string | null;
  status: string;
  onchain_market_pubkey: string | null;
  oracle_source: string;
  resolution_source: string | null;
  settlement_asset: string;
  opens_at: string;
  join_deadline_at: string;
  decision_cutoff_at: string;
  closes_at: string;
  resolves_at: string | null;
  cutoff_at: string | null;
  total_liquidity_usdc: string;
  final_liquidity_usdc: string | null;
  category_id: string;
  created_by_wallet_identity_id: string | null;
  resolver_wallet_identity_id: string | null;
  rules_json: unknown;
  context_json: unknown;
};

type TopicLinkRow = {
  id: string;
  slug: string;
};

type SettlementPositionRow = {
  wallet_identity_id: string;
  market_agent_id: string;
  final_decision_side: string | null;
  decision_confidence: number | null;
  decision_recorded_at: string | null;
  stake_usdc: string;
  position_count: number;
};

type SettlementPlanPositionInput = {
  payout_key: string;
  wallet_identity_id: string;
  market_agent_id: string;
  final_decision_side: string | null;
  decision_confidence: number | null;
  decision_recorded_at: string | null;
  stakeUnits: bigint;
  position_count: number;
};

type SettlementPlanPosition = SettlementPlanPositionInput & {
  is_winner: boolean;
  base_winnings_units: bigint;
  top_agent_bonus_units: bigint;
  gross_units: bigint;
};

export class MarketsService {
  constructor(
    private readonly db: AppDatabase,
    private readonly env: Env,
    private readonly onchainService?: ExoduzeOnchainService,
  ) {}

  async listMarkets(query: ListMarketsQuery) {
    const params: unknown[] = [];
    const where: string[] = [];

    if (query.category) {
      where.push(`c.slug = $${params.length + 1}`);
      params.push(query.category);
    }

    if (query.status) {
      where.push(`(${effectiveMarketStatusSql("m")}) = $${params.length + 1}`);
      params.push(query.status);
    }

    const effectiveStatusSql = effectiveMarketStatusSql("m");
    const baseSql = `
      SELECT
        m.id,
        m.slug,
        m.title,
        m.short_description,
        COALESCE(${usableImageExpressionSql("m.image_uri")}, market_image.image_uri) AS image_uri,
        (${effectiveStatusSql}) AS status,
        c.id AS category_id,
        c.slug AS category_slug,
        c.name AS category_name,
        m.opens_at::text,
        m.join_deadline_at::text,
        m.decision_cutoff_at::text,
        m.closes_at::text,
        m.total_liquidity_usdc::text
      FROM markets m
      JOIN categories c ON c.id = m.category_id
      ${marketImageLateralSql("m")}
      ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY m.opens_at DESC
    `;

    let rows = await queryRows<MarketSummaryRow>(this.db, baseSql, params);

    if (query.topic) {
      const topicSlug = query.topic;
      const filtered: MarketSummaryRow[] = [];
      for (const row of rows) {
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
      rows = filtered;
    }

    const data = await Promise.all(
      rows.map(async (row) => ({
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
        topics: await queryRows<{ id: string; slug: string; name: string }>(
          this.db,
          `
            SELECT t.id, t.slug, t.name
            FROM market_topics mt
            JOIN topics t ON t.id = mt.topic_id
            WHERE mt.market_id = $1
            ORDER BY mt.is_primary DESC, t.name ASC
          `,
          [row.id],
        ),
        timing: {
          opens_at: row.opens_at,
          join_deadline_at: row.join_deadline_at,
          decision_cutoff_at: row.decision_cutoff_at,
          closes_at: row.closes_at,
        },
        liquidity: {
          settlement_asset: "USDC",
          total_liquidity_usdc: row.total_liquidity_usdc,
        },
      })),
    );

    return { data };
  }

  async getMarketDetail(marketIdOrSlug: string, walletAddress?: string) {
    const market = await queryOne<MarketDetailRow>(
      this.db,
      `
        SELECT
          m.id,
          m.slug,
          m.title,
          m.short_description,
          m.description,
          COALESCE(${usableImageExpressionSql("m.image_uri")}, market_image.image_uri) AS image_uri,
          (${effectiveMarketStatusSql("m")}) AS status,
          m.onchain_market_pubkey,
          m.oracle_source,
          m.opens_at::text,
          m.join_deadline_at::text,
          m.decision_cutoff_at::text,
          m.closes_at::text,
          m.resolves_at::text,
          m.final_outcome,
          m.total_liquidity_usdc::text,
          m.final_liquidity_usdc::text,
          m.rules_json,
          m.context_json,
          m.created_by,
          creator.wallet_address AS created_by_wallet_address,
          resolver.wallet_address AS resolver_wallet_address,
          c.id AS category_id,
          c.slug AS category_slug,
          c.name AS category_name
        FROM markets m
        JOIN categories c ON c.id = m.category_id
        LEFT JOIN wallet_identities creator ON creator.id = m.created_by_wallet_identity_id
        LEFT JOIN wallet_identities resolver ON resolver.id = m.resolver_wallet_identity_id
        ${marketImageLateralSql("m")}
        WHERE m.id = $1 OR m.slug = $2
        LIMIT 1
      `,
      [marketIdOrSlug, marketIdOrSlug],
    );

    if (!market) {
      return null;
    }

    const rosterLocked = this.isJoinWindowClosed(market.join_deadline_at);
    const liveAgentDecisionsVisible = this.areLiveAgentDecisionsVisible(
      market.join_deadline_at,
    );

    const marketTopics = await queryRows<{
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
      [market.id],
    );

    const resolution = await queryOne<{
      outcome: string;
      evidence_uri: string | null;
      status: string;
      resolved_at: string | null;
    }>(
      this.db,
      `
        SELECT outcome, evidence_uri, status, resolved_at::text
        FROM oracle_results
        WHERE market_id = $1
        ORDER BY resolved_at DESC NULLS LAST
        LIMIT 1
      `,
      [market.id],
    );

    const resolutionProposal = await queryOne<MarketResolutionProposalRow>(
      this.db,
      `
        SELECT
          mr.id,
          mr.proposed_outcome,
          mr.evidence_snapshot_id,
          mr.evidence_summary,
          mr.proposed_by,
          mr.proposed_at::text,
          mr.dispute_deadline::text,
          mr.status,
          mr.finalized_outcome,
          mr.finalized_at::text,
          mr.finalized_by,
          mr.dispute_reason,
          ts.generated_at::text AS snapshot_generated_at,
          ts.category AS snapshot_category,
          ts.window_hours AS snapshot_window_hours,
          md.id AS dispute_id,
          md.status AS dispute_status,
          md.created_at::text AS dispute_created_at
        FROM market_resolutions mr
        LEFT JOIN topic_snapshots ts ON ts.id = mr.evidence_snapshot_id
        LEFT JOIN market_disputes md ON md.resolution_id = mr.id
        WHERE mr.market_id = $1
        ORDER BY mr.proposed_at DESC, mr.created_at DESC
        LIMIT 1
      `,
      [market.id],
    );
    const finalOutcome =
      resolution?.outcome ??
      resolutionProposal?.finalized_outcome ??
      market.final_outcome ??
      null;

    const agentRows = await queryRows<{
      market_agent_id: string;
      joined_at: string;
      final_decision_side: string | null;
      final_decision_at: string | null;
      decision_confidence: number | null;
      agent_id: string;
      agent_slug: string;
      agent_name: string;
      agent_description: string;
      avatar_uri: string | null;
      version_id: string;
      version_no: number;
      version_label: string;
      model_provider: string;
      model_name: string;
      snapshot_hash: string | null;
      hash_algo: string | null;
      snapshot_uri: string | null;
      prompt_hash: string | null;
      config_hash: string | null;
      verification_status: string | null;
      commit_tx_sig: string | null;
      onchain_commitment_ref: string | null;
    }>(
      this.db,
      `
        SELECT
          ma.id AS market_agent_id,
          ma.joined_at::text,
          ma.final_decision_side,
          ma.final_decision_at::text,
          COALESCE(final_decision.confidence, latest_decision.confidence) AS decision_confidence,
          a.id AS agent_id,
          a.slug AS agent_slug,
          a.name AS agent_name,
          a.description AS agent_description,
          a.avatar_uri,
          av.id AS version_id,
          av.version_no,
          av.version_label,
          av.model_provider,
          av.model_name,
          ac.snapshot_hash,
          ac.hash_algo,
          ac.snapshot_uri,
          ac.prompt_hash,
          ac.config_hash,
          ac.verification_status,
          ac.commit_tx_sig,
          ac.onchain_commitment_ref
        FROM market_agents ma
        JOIN agents a ON a.id = ma.agent_id
        JOIN agent_versions av ON av.id = ma.locked_agent_version_id
        JOIN agent_commitments ac ON ac.market_agent_id = ma.id
        LEFT JOIN agent_market_decisions final_decision
          ON final_decision.id = ma.finalized_from_decision_id
        LEFT JOIN LATERAL (
          SELECT d.confidence
          FROM agent_market_decisions d
          WHERE d.market_agent_id = ma.id
          ORDER BY d.sequence_no DESC, d.decided_at DESC
          LIMIT 1
        ) latest_decision ON final_decision.id IS NULL
        WHERE ma.market_id = $1
          AND ma.status IN ('active', 'settled')
          AND NULLIF(ac.onchain_commitment_ref, '') IS NOT NULL
        ORDER BY a.name ASC
      `,
      [market.id],
    );
    const topBonusEligibleMarketAgentIds =
      this.env.PAYOUT_TOP_AGENT_BONUS_BPS > 0 && isMarketOutcome(finalOutcome)
        ? new Set(
            getTopRankedWinningMarketAgentIds(
              agentRows.map((row) => ({
                market_agent_id: row.market_agent_id,
                final_decision_side: row.final_decision_side,
                decision_confidence: row.decision_confidence,
              })),
              finalOutcome,
            ),
          )
        : new Set<string>();

    const marketAgentSupportRows = await queryRows<MarketAgentSupportRow>(
      this.db,
      `
        SELECT
          ma.id AS market_agent_id,
          COUNT(up.id)::integer AS follower_count,
          COALESCE(SUM(up.stake_usdc), 0)::text AS follower_staked_usdc
        FROM market_agents ma
        JOIN agent_commitments ac ON ac.market_agent_id = ma.id
        LEFT JOIN user_positions up
          ON up.market_agent_id = ma.id
          AND up.market_id = ma.market_id
          AND up.status = 'open'
        WHERE ma.market_id = $1
          AND ma.status IN ('active', 'settled')
          AND NULLIF(ac.onchain_commitment_ref, '') IS NOT NULL
        GROUP BY ma.id
      `,
      [market.id],
    );
    const agentSupportById = new Map(
      marketAgentSupportRows.map((row) => [row.market_agent_id, row]),
    );
    const totalFollowerStakeUnits = marketAgentSupportRows.reduce(
      (total, row) =>
        total +
        this.parseDecimalUnits(
          row.follower_staked_usdc,
          "follower_staked_usdc",
        ),
      0n,
    );

    const agents = await Promise.all(
      agentRows.map(async (row) => {
        const categories = await queryRows<{
          slug: string;
          name: string;
          is_primary: boolean;
        }>(
          this.db,
          `
            SELECT c.slug, c.name, ac.is_primary
            FROM agent_categories ac
            JOIN categories c ON c.id = ac.category_id
            WHERE ac.agent_id = $1
            ORDER BY ac.is_primary DESC, c.name ASC
        `,
          [row.agent_id],
        );

        const currentDecision = liveAgentDecisionsVisible
          ? await queryOne<{
              decision_side: string;
              confidence: number;
              reason_summary: string;
              key_signals: string[] | null;
              risk_factors: string[] | null;
              decided_at: string;
            }>(
              this.db,
              `
                SELECT
                  decision_side,
                  confidence,
                  reason_summary,
                  COALESCE(key_signals, '[]'::jsonb) AS key_signals,
                  COALESCE(risk_factors, '[]'::jsonb) AS risk_factors,
                  decided_at::text
                FROM agent_market_decisions
                WHERE market_agent_id = $1
                ORDER BY sequence_no DESC
                LIMIT 1
              `,
              [row.market_agent_id],
            )
          : null;

        const stats = await queryOne<{
          resolved_markets: number;
          accuracy_pct: string;
          current_streak: number;
          total_staked_usdc: string;
        }>(
          this.db,
          `
            SELECT
              resolved_markets,
              accuracy_pct::text,
              current_streak,
              total_staked_usdc::text
            FROM leaderboard_agent_snapshots
            WHERE agent_id = $1
            ORDER BY window_end DESC
            LIMIT 1
          `,
          [row.agent_id],
        );

        const marketSupport = agentSupportById.get(row.market_agent_id);
        const followerCount = marketSupport
          ? Number(marketSupport.follower_count)
          : 0;
        const followerStakedUsdc = marketSupport?.follower_staked_usdc ?? "0";
        const followerStakeUnits = this.parseDecimalUnits(
          followerStakedUsdc,
          "follower_staked_usdc",
        );

        return {
          market_agent_id: row.market_agent_id,
          agent: {
            id: row.agent_id,
            slug: row.agent_slug,
            name: row.agent_name,
            description: row.agent_description,
            avatar_uri: row.avatar_uri,
            categories: categories.map((category) => ({
              slug: category.slug,
              name: category.name,
              is_primary: Boolean(category.is_primary),
            })),
          },
          locked_version: {
            id: row.version_id,
            version_no: row.version_no,
            version_label: row.version_label,
            model_provider: row.model_provider,
            model_name: row.model_name,
            joined_at: row.joined_at,
          },
          commitment: {
            snapshot_hash: row.snapshot_hash,
            hash_algo: row.hash_algo,
            snapshot_uri: row.snapshot_uri,
            prompt_hash: row.prompt_hash,
            config_hash: row.config_hash,
            verification_status: row.verification_status,
            commit_tx_sig: row.commit_tx_sig,
            onchain_commitment_ref: row.onchain_commitment_ref,
          },
          current_decision: currentDecision
            ? {
                side: currentDecision.decision_side,
                confidence: currentDecision.confidence,
                decided_at: currentDecision.decided_at,
                reason_summary: currentDecision.reason_summary,
                key_signals: this.toStringArray(currentDecision.key_signals),
                risk_factors: this.toStringArray(currentDecision.risk_factors),
              }
            : null,
          final_decision:
            liveAgentDecisionsVisible && row.final_decision_side
              ? {
                  side: row.final_decision_side,
                  confidence: row.decision_confidence,
                  decided_at: row.final_decision_at,
                }
              : null,
          top_bonus_eligible: topBonusEligibleMarketAgentIds.has(
            row.market_agent_id,
          ),
          stats: stats
            ? {
                resolved_markets: Number(stats.resolved_markets),
                accuracy_pct: stats.accuracy_pct,
                current_streak: Number(stats.current_streak),
                follower_staked_usdc: stats.total_staked_usdc,
              }
            : null,
          market_stats: {
            follower_count: followerCount,
            follower_staked_usdc: followerStakedUsdc,
            support_share_pct:
              totalFollowerStakeUnits === 0n
                ? 0
                : Number(
                    (followerStakeUnits * 10_000n) / totalFollowerStakeUnits,
                  ) / 100,
          },
        };
      }),
    );

    const battleEntryRows = await queryRows<BattleEntryRow>(
      this.db,
      `
        SELECT
          be.id,
          be.market_agent_id,
          be.agent_id,
          a.slug AS agent_slug,
          a.name AS agent_name,
          a.description AS agent_description,
          a.avatar_uri AS agent_avatar_uri,
          a.specialization AS agent_specialization,
          a.risk_profile AS agent_risk_profile,
          be.strategy_preset,
          be.technical_weight,
          be.news_weight,
          be.sentiment_weight,
          be.macro_weight,
          be.onchain_weight,
          be.optional_insight,
          be.stake_amount::text,
          be.prediction_json,
          be.prediction_hash,
          be.status,
          be.created_at::text
        FROM battle_entries be
        JOIN agents a ON a.id = be.agent_id
        WHERE be.market_id = $1
        ORDER BY be.created_at DESC
      `,
      [market.id],
    );
    const battlePoolRows = await queryRows<BattlePoolRow>(
      this.db,
      `
        SELECT
          LOWER(COALESCE(be.prediction_json->>'direction', 'neutral')) AS direction,
          COUNT(*)::text AS entry_count,
          COALESCE(SUM(be.stake_amount), 0)::text AS total_stake_usdc
        FROM battle_entries be
        WHERE be.market_id = $1
          AND be.status IN ('locked', 'resolved', 'claimed')
        GROUP BY LOWER(COALESCE(be.prediction_json->>'direction', 'neutral'))
      `,
      [market.id],
    );

    const latestMonitoring = await queryOne<{
      total_agents_count: number;
      yes_agents_count: number;
      no_agents_count: number;
      yes_staked_usdc: string;
      no_staked_usdc: string;
      total_staked_usdc: string;
      recorded_at: string;
    }>(
      this.db,
      `
        SELECT
          total_agents_count,
          yes_agents_count,
          no_agents_count,
          yes_staked_usdc::text,
          no_staked_usdc::text,
          total_staked_usdc::text,
          recorded_at::text
        FROM market_monitoring_points
        WHERE market_id = $1
        ORDER BY recorded_at DESC
        LIMIT 1
      `,
      [market.id],
    );

    const monitoringCurve = await queryRows<{
      recorded_at: string;
      yes_agents_count: number;
      no_agents_count: number;
      yes_staked_usdc: string;
      no_staked_usdc: string;
      total_agents_count: number;
      total_staked_usdc: string;
    }>(
      this.db,
      `
        SELECT
          recorded_at::text,
          yes_agents_count,
          no_agents_count,
          yes_staked_usdc::text,
          no_staked_usdc::text,
          total_agents_count,
          total_staked_usdc::text
        FROM market_monitoring_points
        WHERE market_id = $1
        ORDER BY recorded_at ASC
      `,
      [market.id],
    );
    const settlementPositionRows = isMarketOutcome(finalOutcome)
      ? await queryRows<{
          wallet_identity_id: string;
          market_agent_id: string;
          final_decision_side: string | null;
          decision_confidence: number | null;
          decision_recorded_at: string | null;
          stake_usdc: string;
          position_count: number;
        }>(
          this.db,
          `
            SELECT
              up.wallet_identity_id,
              up.market_agent_id,
              ma.final_decision_side,
              COALESCE(final_decision.confidence, latest_decision.confidence) AS decision_confidence,
              COALESCE(final_decision.decided_at, latest_decision.decided_at)::text AS decision_recorded_at,
              SUM(up.stake_usdc)::text AS stake_usdc,
              COUNT(*)::integer AS position_count
            FROM user_positions up
            JOIN market_agents ma ON ma.id = up.market_agent_id
            LEFT JOIN agent_market_decisions final_decision
              ON final_decision.id = ma.finalized_from_decision_id
            LEFT JOIN LATERAL (
              SELECT d.confidence, d.decided_at
              FROM agent_market_decisions d
              WHERE d.market_agent_id = ma.id
              ORDER BY d.sequence_no DESC, d.decided_at DESC
              LIMIT 1
            ) latest_decision ON final_decision.id IS NULL
            WHERE up.market_id = $1
              AND up.status IN ('open', 'settled')
            GROUP BY
              up.wallet_identity_id,
              up.market_agent_id,
              ma.final_decision_side,
              COALESCE(final_decision.confidence, latest_decision.confidence),
              COALESCE(final_decision.decided_at, latest_decision.decided_at)
            ORDER BY up.wallet_identity_id, up.market_agent_id
          `,
          [market.id],
        )
      : [];
    const settlementPositions = settlementPositionRows.map((position) => ({
      payout_key: `${position.wallet_identity_id}:${position.market_agent_id}`,
      ...position,
      stakeUnits: this.parseDecimalUnits(position.stake_usdc, "stake_usdc"),
    }));
    const settlementSummary = isMarketOutcome(finalOutcome)
      ? (() => {
          const settlementPlan = buildHybridSettlementPlan({
            positions: settlementPositions,
            outcome: finalOutcome,
            topAgentBonusBps: this.env.PAYOUT_TOP_AGENT_BONUS_BPS,
          });
          const feeBps = BigInt(this.env.PAYOUT_FEE_BPS);
          let totalGrossUnits = 0n;
          let totalFeeUnits = 0n;

          for (const position of settlementPlan.positions) {
            if (!position.is_winner || position.gross_units <= 0n) {
              continue;
            }

            totalGrossUnits += position.gross_units;
            totalFeeUnits += (position.gross_units * feeBps) / BPS_DENOMINATOR;
          }

          return {
            winning_stake_usdc: this.formatDecimalUnits(
              settlementPlan.winning_stake_units,
            ),
            losing_stake_usdc: this.formatDecimalUnits(
              settlementPlan.losing_stake_units,
            ),
            base_prize_pool_usdc: this.formatDecimalUnits(
              settlementPlan.base_prize_pool_units,
            ),
            top_agent_bonus_pool_usdc: this.formatDecimalUnits(
              settlementPlan.top_agent_bonus_pool_units,
            ),
            total_gross_usdc: this.formatDecimalUnits(totalGrossUnits),
            total_fee_usdc: this.formatDecimalUnits(totalFeeUnits),
            total_net_usdc: this.formatDecimalUnits(
              totalGrossUnits - totalFeeUnits,
            ),
            fee_bps: this.env.PAYOUT_FEE_BPS,
            top_agent_bonus_bps: this.env.PAYOUT_TOP_AGENT_BONUS_BPS,
            top_ranked_market_agent_ids:
              settlementPlan.top_ranked_market_agent_ids,
          };
        })()
      : null;

    const decisionTrail = liveAgentDecisionsVisible
      ? await queryRows<{
          id: string;
          sequence_no: number;
          decision_side: string;
          confidence: number;
          reason_summary: string;
          key_signals: string[] | null;
          risk_factors: string[] | null;
          decided_at: string;
          market_agent_id: string;
          agent_id: string;
          agent_name: string;
        }>(
          this.db,
          `
            SELECT
              d.id,
              d.sequence_no,
              d.decision_side,
              d.confidence,
              d.reason_summary,
              COALESCE(d.key_signals, '[]'::jsonb) AS key_signals,
              COALESCE(d.risk_factors, '[]'::jsonb) AS risk_factors,
              d.decided_at::text,
              ma.id AS market_agent_id,
              a.id AS agent_id,
              a.name AS agent_name
            FROM agent_market_decisions d
            JOIN market_agents ma ON ma.id = d.market_agent_id
            JOIN agent_commitments ac ON ac.market_agent_id = ma.id
            JOIN agents a ON a.id = ma.agent_id
            WHERE ma.market_id = $1
              AND ma.status IN ('active', 'settled')
              AND NULLIF(ac.onchain_commitment_ref, '') IS NOT NULL
            ORDER BY d.decided_at DESC, d.sequence_no DESC
          `,
          [market.id],
        )
      : [];

    let userContext: {
      wallet_address: string;
      positions: Array<{
        position_id: string;
        market_agent_id: string;
        agent_id: string;
        stake_usdc: string;
        status: string;
        opened_at: string;
      }>;
      payouts: Array<{
        payout_id: string;
        market_agent_id: string;
        gross_usdc: string;
        fee_usdc: string;
        net_usdc: string;
        payout_tx_sig: string | null;
        status: string;
        paid_at: string | null;
        breakdown?: {
          stake_return_usdc: string;
          base_pool_winnings_usdc: string;
          top_agent_bonus_usdc: string;
          gross_usdc: string;
          fee_usdc: string;
          net_usdc: string;
        };
      }>;
    } | null = null;

    if (walletAddress) {
      const wallet = await queryOne<{ id: string; wallet_address: string }>(
        this.db,
        "SELECT id, wallet_address FROM wallet_identities WHERE wallet_address = $1",
        [walletAddress],
      );

      if (wallet) {
        const positions = await queryRows<{
          position_id: string;
          market_agent_id: string;
          agent_id: string;
          stake_usdc: string;
          position_units: string | null;
          onchain_position_ref: string | null;
          open_tx_sig: string | null;
          status: string;
          opened_at: string;
        }>(
          this.db,
          `
            SELECT
              up.id AS position_id,
              up.market_agent_id,
              ma.agent_id,
              up.stake_usdc::text,
              up.position_units::text,
              up.onchain_position_ref,
              up.open_tx_sig,
              up.status,
              up.created_at::text AS opened_at
            FROM user_positions up
            JOIN market_agents ma ON ma.id = up.market_agent_id
            WHERE up.market_id = $1 AND up.wallet_identity_id = $2
            ORDER BY up.created_at DESC
          `,
          [market.id, wallet.id],
        );

        const payouts = await queryRows<{
          payout_id: string;
          market_agent_id: string;
          gross_usdc: string;
          fee_usdc: string;
          net_usdc: string;
          payout_tx_sig: string | null;
          status: string;
          paid_at: string | null;
        }>(
          this.db,
          `
            SELECT
              id AS payout_id,
              market_agent_id,
              gross_usdc::text,
              fee_usdc::text,
              net_usdc::text,
              payout_tx_sig,
              status,
              paid_at::text
            FROM payouts
            WHERE market_id = $1 AND wallet_identity_id = $2
            ORDER BY paid_at DESC NULLS LAST
          `,
          [market.id, wallet.id],
        );
        let payoutBreakdownByPositionKey = new Map<
          string,
          {
            stake_return_usdc: string;
            base_pool_winnings_usdc: string;
            top_agent_bonus_usdc: string;
            gross_usdc: string;
            fee_usdc: string;
            net_usdc: string;
          }
        >();

        if (isMarketOutcome(finalOutcome)) {
          const payoutPlan = buildHybridPayoutBreakdownByPositionKey({
            positions: settlementPositions,
            outcome: finalOutcome,
            topAgentBonusBps: this.env.PAYOUT_TOP_AGENT_BONUS_BPS,
            payoutFeeBps: this.env.PAYOUT_FEE_BPS,
          });
          payoutBreakdownByPositionKey = new Map(
            [...payoutPlan.breakdownByPositionKey.entries()].map(
              ([positionKey, breakdown]) => [
                positionKey,
                {
                  stake_return_usdc: this.formatDecimalUnits(
                    breakdown.principal_units,
                  ),
                  base_pool_winnings_usdc: this.formatDecimalUnits(
                    breakdown.base_pool_winnings_units,
                  ),
                  top_agent_bonus_usdc: this.formatDecimalUnits(
                    breakdown.top_agent_bonus_units,
                  ),
                  gross_usdc: this.formatDecimalUnits(breakdown.gross_units),
                  fee_usdc: this.formatDecimalUnits(breakdown.fee_units),
                  net_usdc: this.formatDecimalUnits(breakdown.net_units),
                },
              ],
            ),
          );
        }

        userContext = {
          wallet_address: wallet.wallet_address,
          positions: positions.map((position) => ({
            ...position,
            top_bonus_eligible: topBonusEligibleMarketAgentIds.has(
              position.market_agent_id,
            ),
          })),
          payouts: payouts.map((payout) => {
            const breakdown = payoutBreakdownByPositionKey.get(
              `${wallet.id}:${payout.market_agent_id}`,
            );

            return {
              ...payout,
              top_bonus_eligible: topBonusEligibleMarketAgentIds.has(
                payout.market_agent_id,
              ),
              ...(breakdown ? { breakdown } : {}),
            };
          }),
        };
      }
    }

    return {
      data: {
        market: {
          id: market.id,
          slug: market.slug,
          title: market.title,
          short_description: market.short_description,
          description: market.description,
          image_uri: market.image_uri,
          status: market.status,
          category: {
            id: market.category_id,
            slug: market.category_slug,
            name: market.category_name,
          },
          topics: marketTopics,
          timing: {
            opens_at: market.opens_at,
            join_deadline_at: market.join_deadline_at,
            decision_cutoff_at: market.decision_cutoff_at,
            closes_at: market.closes_at,
            resolves_at: market.resolves_at,
          },
          resolution: {
            oracle_source: market.oracle_source,
            oracle_status:
              resolutionProposal?.status ?? resolution?.status ?? "pending",
            final_outcome: finalOutcome,
            resolved_at: resolution?.resolved_at ?? null,
            evidence_uri: resolution?.evidence_uri ?? null,
            proposed_outcome: resolutionProposal?.proposed_outcome ?? null,
            proposed_by: resolutionProposal?.proposed_by ?? null,
            proposed_at: resolutionProposal?.proposed_at ?? null,
            dispute_deadline: resolutionProposal?.dispute_deadline ?? null,
            evidence_summary: resolutionProposal?.evidence_summary ?? null,
            proposal_status: resolutionProposal?.status ?? null,
            resolution_id: resolutionProposal?.id ?? null,
            evidence_snapshot: resolutionProposal
              ? {
                  id: resolutionProposal.evidence_snapshot_id,
                  category: resolutionProposal.snapshot_category,
                  generated_at: resolutionProposal.snapshot_generated_at,
                  window_hours: resolutionProposal.snapshot_window_hours
                    ? Number(resolutionProposal.snapshot_window_hours)
                    : null,
                }
              : null,
            dispute: resolutionProposal?.dispute_id
              ? {
                  id: resolutionProposal.dispute_id,
                  status: resolutionProposal.dispute_status,
                  reason: resolutionProposal.dispute_reason,
                  created_at: resolutionProposal.dispute_created_at,
                }
              : null,
            settlement_summary: settlementSummary,
          },
          transparency: {
            created_by_wallet: market.created_by_wallet_address,
            created_by_actor: getMarketCreatedByActorLabel(market.created_by),
            resolver_wallet: market.resolver_wallet_address,
            resolver_actor: getMarketResolverActorLabel(market.oracle_source),
            rules: Array.isArray(market.rules_json) ? market.rules_json : [],
            context:
              market.context_json && typeof market.context_json === "object"
                ? market.context_json
                : {},
          },
          settlement: {
            asset: "USDC",
            total_liquidity_usdc: market.total_liquidity_usdc,
            final_liquidity_usdc: market.final_liquidity_usdc,
          },
          onchain: {
            market_pubkey: market.onchain_market_pubkey,
            program_id: this.env.EXODUZE_PROGRAM_ID,
          },
          fairness: {
            roster_locked: rosterLocked,
            join_deadline_at: market.join_deadline_at,
            live_agent_decisions_visible: liveAgentDecisionsVisible,
            live_agent_decisions_visible_at: market.join_deadline_at,
          },
        },
        agents,
        monitoring: {
          summary: latestMonitoring
            ? {
                total_agents: Number(latestMonitoring.total_agents_count),
                yes_agents: Number(latestMonitoring.yes_agents_count),
                no_agents: Number(latestMonitoring.no_agents_count),
                yes_staked_usdc: latestMonitoring.yes_staked_usdc,
                no_staked_usdc: latestMonitoring.no_staked_usdc,
                total_staked_usdc: latestMonitoring.total_staked_usdc,
                last_updated_at: latestMonitoring.recorded_at,
              }
            : null,
          curve: monitoringCurve,
        },
        ai_decision_trail: decisionTrail.map((entry) => ({
          id: entry.id,
          market_agent_id: entry.market_agent_id,
          agent: {
            id: entry.agent_id,
            name: entry.agent_name,
          },
          sequence_no: Number(entry.sequence_no),
          decision_side: entry.decision_side,
          confidence: entry.confidence,
          reason_summary: entry.reason_summary,
          key_signals: this.toStringArray(entry.key_signals),
          risk_factors: this.toStringArray(entry.risk_factors),
          decided_at: entry.decided_at,
        })),
        battle_pool: {
          total_entries: battlePoolRows.reduce(
            (total, row) => total + Number(row.entry_count),
            0,
          ),
          total_staked_usdc: this.formatDecimalUnits(
            battlePoolRows.reduce(
              (total, row) =>
                total +
                this.parseDecimalUnits(row.total_stake_usdc, "total_stake_usdc"),
              0n,
            ),
          ),
          pools: battlePoolRows.map((row) => ({
            direction: row.direction ?? "neutral",
            entry_count: Number(row.entry_count),
            total_stake_usdc: row.total_stake_usdc,
          })),
        },
        battle_entries: battleEntryRows.map((entry) => ({
          id: entry.id,
          market_agent_id: entry.market_agent_id,
          agent: {
            id: entry.agent_id,
            slug: entry.agent_slug,
            name: entry.agent_name,
            description: entry.agent_description,
            avatar_uri: entry.agent_avatar_uri,
            specialization: entry.agent_specialization,
            risk_profile: entry.agent_risk_profile,
          },
          strategy: {
            preset: entry.strategy_preset,
            technical_weight: Number(entry.technical_weight),
            news_weight: Number(entry.news_weight),
            sentiment_weight: Number(entry.sentiment_weight),
            macro_weight: Number(entry.macro_weight),
            onchain_weight: Number(entry.onchain_weight),
            optional_insight: entry.optional_insight,
          },
          stake_amount: entry.stake_amount,
          prediction_json:
            entry.prediction_json && typeof entry.prediction_json === "object"
              ? entry.prediction_json
              : {},
          prediction_hash: entry.prediction_hash,
          status: entry.status,
          created_at: entry.created_at,
        })),
        user_context: userContext,
      },
    };
  }

  async getMarketRealtimeRevision(marketIdOrSlug: string) {
    const row = await queryOne<MarketRealtimeRevisionRow>(
      this.db,
      `
        WITH target AS (
          SELECT id, slug, updated_at
          FROM markets
          WHERE id = $1 OR slug = $2
          LIMIT 1
        )
        SELECT
          target.id,
          target.slug,
          GREATEST(
            target.updated_at,
            aggregate.market_agents_updated_at,
            aggregate.battle_entries_updated_at,
            aggregate.commitments_updated_at,
            aggregate.decisions_updated_at,
            aggregate.positions_updated_at,
            aggregate.monitoring_updated_at,
            aggregate.oracle_results_updated_at,
            aggregate.resolutions_updated_at,
            aggregate.disputes_updated_at,
            aggregate.payouts_updated_at
          )::text AS revision_at,
          CONCAT_WS(
            ':',
            ROUND(
              EXTRACT(
                EPOCH FROM GREATEST(
                  target.updated_at,
                  aggregate.market_agents_updated_at,
                  aggregate.battle_entries_updated_at,
                  aggregate.commitments_updated_at,
                  aggregate.decisions_updated_at,
                  aggregate.positions_updated_at,
                  aggregate.monitoring_updated_at,
                  aggregate.oracle_results_updated_at,
                  aggregate.resolutions_updated_at,
                  aggregate.disputes_updated_at,
                  aggregate.payouts_updated_at
                )
              ) * 1000
            )::bigint::text,
            aggregate.market_agent_count::text,
            aggregate.battle_entry_count::text,
            aggregate.decision_count::text,
            aggregate.position_count::text,
            aggregate.monitoring_count::text,
            aggregate.oracle_result_count::text,
            aggregate.resolution_count::text,
            aggregate.dispute_count::text,
            aggregate.payout_count::text
          ) AS revision
        FROM target
        CROSS JOIN LATERAL (
          SELECT
            COALESCE(
              (
                SELECT MAX(ma.updated_at)
                FROM market_agents ma
                WHERE ma.market_id = target.id
              ),
              to_timestamp(0)
            ) AS market_agents_updated_at,
            COALESCE(
              (
                SELECT MAX(be.updated_at)
                FROM battle_entries be
                WHERE be.market_id = target.id
              ),
              to_timestamp(0)
            ) AS battle_entries_updated_at,
            COALESCE(
              (
                SELECT MAX(ac.updated_at)
                FROM market_agents ma
                JOIN agent_commitments ac ON ac.market_agent_id = ma.id
                WHERE ma.market_id = target.id
              ),
              to_timestamp(0)
            ) AS commitments_updated_at,
            COALESCE(
              (
                SELECT MAX(ad.created_at)
                FROM market_agents ma
                JOIN agent_market_decisions ad ON ad.market_agent_id = ma.id
                WHERE ma.market_id = target.id
              ),
              to_timestamp(0)
            ) AS decisions_updated_at,
            COALESCE(
              (
                SELECT MAX(up.updated_at)
                FROM user_positions up
                WHERE up.market_id = target.id
              ),
              to_timestamp(0)
            ) AS positions_updated_at,
            COALESCE(
              (
                SELECT MAX(mp.created_at)
                FROM market_monitoring_points mp
                WHERE mp.market_id = target.id
              ),
              to_timestamp(0)
            ) AS monitoring_updated_at,
            COALESCE(
              (
                SELECT MAX(orx.updated_at)
                FROM oracle_results orx
                WHERE orx.market_id = target.id
              ),
              to_timestamp(0)
            ) AS oracle_results_updated_at,
            COALESCE(
              (
                SELECT MAX(mr.updated_at)
                FROM market_resolutions mr
                WHERE mr.market_id = target.id
              ),
              to_timestamp(0)
            ) AS resolutions_updated_at,
            COALESCE(
              (
                SELECT MAX(COALESCE(md.resolved_at, md.created_at))
                FROM market_disputes md
                WHERE md.market_id = target.id
              ),
              to_timestamp(0)
            ) AS disputes_updated_at,
            COALESCE(
              (
                SELECT MAX(p.updated_at)
                FROM payouts p
                WHERE p.market_id = target.id
              ),
              to_timestamp(0)
            ) AS payouts_updated_at,
            (
              SELECT COUNT(*)::integer
              FROM market_agents ma
              WHERE ma.market_id = target.id
            ) AS market_agent_count,
            (
              SELECT COUNT(*)::integer
              FROM battle_entries be
              WHERE be.market_id = target.id
            ) AS battle_entry_count,
            (
              SELECT COUNT(*)::integer
              FROM market_agents ma
              JOIN agent_market_decisions ad ON ad.market_agent_id = ma.id
              WHERE ma.market_id = target.id
            ) AS decision_count,
            (
              SELECT COUNT(*)::integer
              FROM user_positions up
              WHERE up.market_id = target.id
            ) AS position_count,
            (
              SELECT COUNT(*)::integer
              FROM market_monitoring_points mp
              WHERE mp.market_id = target.id
            ) AS monitoring_count,
            (
              SELECT COUNT(*)::integer
              FROM oracle_results orx
              WHERE orx.market_id = target.id
            ) AS oracle_result_count,
            (
              SELECT COUNT(*)::integer
              FROM market_resolutions mr
              WHERE mr.market_id = target.id
            ) AS resolution_count,
            (
              SELECT COUNT(*)::integer
              FROM market_disputes md
              WHERE md.market_id = target.id
            ) AS dispute_count,
            (
              SELECT COUNT(*)::integer
              FROM payouts p
              WHERE p.market_id = target.id
            ) AS payout_count
        ) aggregate
      `,
      [marketIdOrSlug, marketIdOrSlug],
    );

    return row
      ? {
          marketId: row.id,
          marketSlug: row.slug,
          revisionAt: row.revision_at,
          revision: row.revision,
        }
      : null;
  }

  async createMarket(
    input: MarketMutationInput,
    options: { createdByWalletId?: string | null } = {},
  ) {
    const client = await this.db.connect();

    try {
      await client.query("BEGIN");

      const category = await this.requireCategory(input.category, client);
      const slug = this.ensureMarketSlug(input.slug ?? input.title);
      const id = createStableId("mkt", slug);
      const topicRows = await this.requireTopics(
        category.id,
        input.topicSlugs,
        client,
      );
      const resolverIdentity = input.resolverWallet
        ? await this.ensureWalletIdentity(input.resolverWallet, client)
        : null;
      const joinDeadlineAt =
        input.joinDeadlineAt ??
        this.buildDefaultJoinDeadlineAt(
          input.opensAt,
          input.decisionCutoffAt,
          input.closesAt,
          input.resolvesAt ?? null,
        );

      this.assertMarketTiming(
        input.opensAt,
        joinDeadlineAt,
        input.decisionCutoffAt,
        input.closesAt,
        input.resolvesAt ?? null,
      );

      await client.query(
        `
          INSERT INTO markets (
            id,
            slug,
            onchain_market_pubkey,
            image_uri,
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
            created_by_wallet_identity_id,
            resolver_wallet_identity_id,
            rules_json,
            context_json,
            created_at,
            updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15, $16, $17, $18,
            $19, $20, $21, $22, $23, $24, $25, $26::jsonb, $27::jsonb, now(), now()
          )
        `,
        [
          id,
          slug,
          input.onchainMarketPubkey ?? null,
          input.imageUri ?? null,
          input.title.trim(),
          input.shortDescription.trim(),
          input.description.trim(),
          category.id,
          input.status,
          input.oracleSource.trim(),
          input.settlementAsset.trim(),
          input.opensAt,
          joinDeadlineAt,
          input.decisionCutoffAt,
          input.decisionCutoffAt,
          input.closesAt,
          input.resolvesAt ?? null,
          input.totalLiquidityUsdc,
          input.finalLiquidityUsdc ?? null,
          "YES_NO",
          input.oracleSource.trim() === "exoduze_topic_snapshots"
            ? "topic_snapshots"
            : null,
          3,
          "admin",
          options.createdByWalletId ?? null,
          resolverIdentity?.id ?? null,
          JSON.stringify(input.rules ?? []),
          JSON.stringify(input.context ?? {}),
        ],
      );

      await this.syncMarketTopics(client, id, topicRows);
      await client.query("COMMIT");

      return this.requireMarketDetailView(id);
    } catch (error) {
      await client.query("ROLLBACK");
      if (isPgErrorCode(error, "23505")) {
        throw new HttpError(
          409,
          "MARKET_SLUG_CONFLICT",
          "A market with that slug already exists.",
        );
      }

      throw error;
    } finally {
      client.release();
    }
  }

  async replaceMarket(marketIdOrSlug: string, input: MarketMutationInput) {
    return this.updateMarket(marketIdOrSlug, input, true);
  }

  async patchMarket(
    marketIdOrSlug: string,
    input: Partial<MarketMutationInput>,
  ) {
    return this.updateMarket(marketIdOrSlug, input, false);
  }

  async resolveMarket(marketIdOrSlug: string, input: MarketResolveInput) {
    const client = await this.db.connect();

    try {
      await client.query("BEGIN");

      const market = await this.requireManagedMarket(marketIdOrSlug, client);
      await this.lockMarketRow(client, market.id);
      const effectiveStatus = getEffectiveMarketStatus(market);
      if (!["closed", "resolving", "resolved"].includes(effectiveStatus)) {
        throw new HttpError(
          409,
          "MARKET_NOT_READY_TO_RESOLVE",
          "Only closed or resolving markets can be resolved.",
        );
      }

      const activeAutomaticResolution = await queryOne<{
        id: string;
        status: string;
      }>(
        client,
        `
          SELECT id, status
          FROM market_resolutions
          WHERE market_id = $1
            AND status IN ('proposed', 'disputed')
          ORDER BY proposed_at DESC, created_at DESC
          LIMIT 1
        `,
        [market.id],
      );

      if (activeAutomaticResolution) {
        throw new HttpError(
          409,
          "MARKET_RESOLUTION_PROPOSAL_ACTIVE",
          activeAutomaticResolution.status === "disputed"
            ? "This market has an open dispute. Use the admin dispute endpoints to finalize it."
            : "This market already has a proposed automatic resolution. Wait for the finalizer or resolve it through the dispute flow.",
        );
      }

      const settlement = await this.settleMarketPayouts(client, market, input);

      await client.query("COMMIT");

      const detail = await this.requireMarketDetailView(market.id);
      return {
        data: {
          ...detail.data,
          resolution_settlement: settlement,
        },
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteMarket(marketIdOrSlug: string) {
    const market = await this.requireManagedMarket(marketIdOrSlug);
    let onchainCancel: Awaited<
      ReturnType<ExoduzeOnchainService["cancelMarket"]>
    > | null = null;

    if (market.onchain_market_pubkey) {
      if (!this.onchainService) {
        throw new HttpError(
          500,
          "ONCHAIN_CLIENT_NOT_CONFIGURED",
          "On-chain client is not configured.",
        );
      }

      if (!this.onchainService.isValidPublicKey(market.onchain_market_pubkey)) {
        throw new HttpError(
          500,
          "ONCHAIN_MARKET_PUBKEY_INVALID",
          "Market has an invalid on-chain public key.",
        );
      }

      onchainCancel = await this.onchainService.cancelMarket({
        marketPubkey: market.onchain_market_pubkey,
      });
    }

    await this.db.query(
      `
        UPDATE markets
        SET status = 'cancelled', updated_at = now()
        WHERE id = $1
      `,
      [market.id],
    );

    const result = await this.requireMarketDetailView(market.id);
    return {
      data: {
        ...result.data,
        deleted: true,
        onchain_cancel: onchainCancel,
      },
    };
  }

  async publishMarketOnchain(marketIdOrSlug: string) {
    if (!this.onchainService) {
      throw new HttpError(
        500,
        "ONCHAIN_CLIENT_NOT_CONFIGURED",
        "On-chain client is not configured.",
      );
    }

    const market = await this.requireManagedMarket(marketIdOrSlug);
    if (
      market.onchain_market_pubkey &&
      !this.onchainService.isValidPublicKey(market.onchain_market_pubkey)
    ) {
      throw new HttpError(
        500,
        "ONCHAIN_MARKET_PUBKEY_INVALID",
        "Market has an invalid on-chain public key.",
      );
    }

    if (this.onchainService.isValidPublicKey(market.onchain_market_pubkey)) {
      const detail = await this.requireMarketDetailView(market.id);
      return {
        data: {
          ...detail.data,
          onchain_publish: {
            already_published: true,
            tx_sig: null,
            market_pubkey: market.onchain_market_pubkey,
          },
        },
      };
    }

    if (
      market.resolution_source === "topic_snapshots" &&
      !(await this.hasLinkedNewsContext(market.id, market.context_json))
    ) {
      throw new HttpError(
        409,
        "MARKET_NEWS_CONTEXT_REQUIRED",
        "Topic-snapshot markets must have linked news before they can be published on-chain.",
      );
    }

    const published = await this.onchainService.createMarket({
      marketId: market.id,
      opensAt: market.opens_at,
      joinDeadlineAt: market.join_deadline_at,
      decisionCutoffAt: market.decision_cutoff_at,
      closesAt: market.closes_at,
      resolvesAt: market.resolves_at,
      settlementMint: this.env.EXODUZE_SETTLEMENT_MINT,
    });

    await this.db.query(
      `
        UPDATE markets
        SET onchain_market_pubkey = $2, updated_at = now()
        WHERE id = $1
      `,
      [market.id, published.market_pubkey],
    );

    const detail = await this.requireMarketDetailView(market.id);
    return {
      data: {
        ...detail.data,
        onchain_publish: published,
      },
    };
  }

  async getMarketAgentSnapshot(marketIdOrSlug: string, marketAgentId: string) {
    const snapshot = await queryOne<{
      market_id: string;
      market_slug: string;
      market_title: string;
      market_agent_id: string;
      agent_id: string;
      agent_slug: string;
      agent_name: string;
      snapshot_uri: string | null;
      snapshot_hash: string | null;
      hash_algo: string | null;
      prompt_hash: string | null;
      config_hash: string | null;
      verification_status: string | null;
      commit_tx_sig: string | null;
      onchain_commitment_ref: string | null;
      artifact_id: string | null;
      artifact_hash: string | null;
      canonicalization_version: string | null;
      published_at: string | null;
      payload_json: unknown;
    }>(
      this.db,
      `
        SELECT
          m.id AS market_id,
          m.slug AS market_slug,
          m.title AS market_title,
          ma.id AS market_agent_id,
          a.id AS agent_id,
          a.slug AS agent_slug,
          a.name AS agent_name,
          ac.snapshot_uri,
          ac.snapshot_hash,
          ac.hash_algo,
          ac.prompt_hash,
          ac.config_hash,
          ac.verification_status,
          ac.commit_tx_sig,
          ac.onchain_commitment_ref,
          pa.id AS artifact_id,
          pa.artifact_hash,
          pa.canonicalization_version,
          pa.published_at::text,
          pa.payload_json
        FROM markets m
        JOIN market_agents ma ON ma.market_id = m.id
        JOIN agents a ON a.id = ma.agent_id
        LEFT JOIN agent_commitments ac ON ac.market_agent_id = ma.id
        LEFT JOIN prompt_artifacts pa ON pa.artifact_uri = ac.snapshot_uri
        WHERE (m.id = $1 OR m.slug = $1)
          AND ma.id = $2
        LIMIT 1
      `,
      [marketIdOrSlug, marketAgentId],
    );

    if (!snapshot) {
      return null;
    }

    return {
      data: {
        market: {
          id: snapshot.market_id,
          slug: snapshot.market_slug,
          title: snapshot.market_title,
        },
        market_agent: {
          id: snapshot.market_agent_id,
          agent: {
            id: snapshot.agent_id,
            slug: snapshot.agent_slug,
            name: snapshot.agent_name,
          },
        },
        commitment: {
          snapshot_uri: snapshot.snapshot_uri,
          snapshot_hash: snapshot.snapshot_hash,
          hash_algo: snapshot.hash_algo,
          prompt_hash: snapshot.prompt_hash,
          config_hash: snapshot.config_hash,
          verification_status: snapshot.verification_status,
          commit_tx_sig: snapshot.commit_tx_sig,
          onchain_commitment_ref: snapshot.onchain_commitment_ref,
        },
        artifact: {
          id: snapshot.artifact_id,
          artifact_hash: snapshot.artifact_hash,
          canonicalization_version: snapshot.canonicalization_version,
          published_at: snapshot.published_at,
        },
        payload: snapshot.payload_json,
      },
    };
  }

  async getMarketNews(marketIdOrSlug: string) {
    const market = await queryOne<{ id: string }>(
      this.db,
      "SELECT id FROM markets WHERE id = $1 OR slug = $2 LIMIT 1",
      [marketIdOrSlug, marketIdOrSlug],
    );

    if (!market) {
      return null;
    }

    const linkedNews = await queryRows<{
      id: string;
      title: string;
      summary: string | null;
      url: string;
      image_uri: string | null;
      published_at: string;
      is_breaking: boolean;
      relevance_score: number | string;
      matches_primary_topic: boolean;
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
          COALESCE(nim.relevance_score, 0)::text AS relevance_score,
          EXISTS (
            SELECT 1
            FROM market_topics mt
            JOIN news_item_topics nit ON nit.topic_id = mt.topic_id
            WHERE mt.market_id = nim.market_id
              AND mt.is_primary = true
              AND nit.news_item_id = ni.id
            LIMIT 1
          ) AS matches_primary_topic,
          ns.slug AS source_slug,
          ns.name AS source_name,
          c.slug AS category_slug,
          c.name AS category_name
        FROM news_item_markets nim
        JOIN news_items ni ON ni.id = nim.news_item_id
        JOIN news_sources ns ON ns.id = ni.source_id
        LEFT JOIN categories c ON c.id = ni.category_id
        WHERE nim.market_id = $1
        ORDER BY
          matches_primary_topic DESC,
          COALESCE(nim.relevance_score, 0) DESC,
          nim.created_at ASC,
          ni.published_at DESC
      `,
      [market.id],
    );

    const data = await Promise.all(
      linkedNews.map(async (item) => ({
        id: item.id,
        title: item.title,
        summary: item.summary,
        url: item.url,
        image_uri: item.image_uri,
        published_at: item.published_at,
        is_breaking: Boolean(item.is_breaking),
        source: {
          slug: item.source_slug,
          name: item.source_name,
        },
        category: item.category_slug
          ? {
              slug: item.category_slug,
              name: item.category_name,
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
          [item.id],
        ),
      })),
    );

    return { data };
  }

  private async settleMarketPayouts(
    client: PoolClient,
    market: ManagedMarketRow,
    input: MarketResolveInput,
  ) {
    const resolvedAt = input.resolvedAt ?? new Date().toISOString();
    const existingResolution = await queryOne<{
      id: string;
      outcome: string;
      status: string;
    }>(
      client,
      `
        SELECT id, outcome, status
        FROM oracle_results
        WHERE market_id = $1 AND status = 'confirmed'
        ORDER BY resolved_at DESC NULLS LAST, created_at DESC
        LIMIT 1
      `,
      [market.id],
    );

    if (existingResolution && existingResolution.outcome !== input.outcome) {
      throw new HttpError(
        409,
        "MARKET_ALREADY_RESOLVED",
        `This market already has confirmed outcome '${existingResolution.outcome}'.`,
      );
    }

    const oracleResultId =
      existingResolution?.id ??
      createStableId("oracle", `${market.id}:${input.outcome}`);
    await client.query(
      `
        INSERT INTO oracle_results (
          id,
          market_id,
          outcome,
          oracle_source,
          evidence_uri,
          submitted_by_wallet_id,
          submitted_tx_sig,
          status,
          resolved_at,
          created_at,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, 'confirmed', $8, now(), now()
        )
        ON CONFLICT (id) DO UPDATE
        SET
          outcome = excluded.outcome,
          oracle_source = excluded.oracle_source,
          evidence_uri = COALESCE(excluded.evidence_uri, oracle_results.evidence_uri),
          submitted_by_wallet_id = COALESCE(excluded.submitted_by_wallet_id, oracle_results.submitted_by_wallet_id),
          submitted_tx_sig = COALESCE(excluded.submitted_tx_sig, oracle_results.submitted_tx_sig),
          status = 'confirmed',
          resolved_at = excluded.resolved_at,
          updated_at = now()
      `,
      [
        oracleResultId,
        market.id,
        input.outcome,
        market.oracle_source,
        input.evidenceUri ?? null,
        input.submittedByWalletId ?? null,
        input.submittedTxSig ?? null,
        resolvedAt,
      ],
    );

    const positionRows = await queryRows<SettlementPositionRow>(
      client,
      `
        SELECT
          up.wallet_identity_id,
          up.market_agent_id,
          ma.final_decision_side,
          COALESCE(final_decision.confidence, latest_decision.confidence) AS decision_confidence,
          COALESCE(final_decision.decided_at, latest_decision.decided_at)::text AS decision_recorded_at,
          SUM(up.stake_usdc)::text AS stake_usdc,
          COUNT(*)::integer AS position_count
        FROM user_positions up
        JOIN market_agents ma ON ma.id = up.market_agent_id
        LEFT JOIN agent_market_decisions final_decision
          ON final_decision.id = ma.finalized_from_decision_id
        LEFT JOIN LATERAL (
          SELECT d.confidence, d.decided_at
          FROM agent_market_decisions d
          WHERE d.market_agent_id = ma.id
          ORDER BY d.sequence_no DESC, d.decided_at DESC
          LIMIT 1
        ) latest_decision ON final_decision.id IS NULL
        WHERE up.market_id = $1
          AND up.status IN ('open', 'settled')
        GROUP BY
          up.wallet_identity_id,
          up.market_agent_id,
          ma.final_decision_side,
          COALESCE(final_decision.confidence, latest_decision.confidence),
          COALESCE(final_decision.decided_at, latest_decision.decided_at)
        ORDER BY up.wallet_identity_id, up.market_agent_id
      `,
      [market.id],
    );

    const positions = positionRows.map((position) => ({
      payout_key: `${position.wallet_identity_id}:${position.market_agent_id}`,
      ...position,
      stakeUnits: this.parseDecimalUnits(position.stake_usdc, "stake_usdc"),
    }));

    const settlementPlan = buildHybridSettlementPlan({
      positions,
      outcome: input.outcome,
      topAgentBonusBps: this.env.PAYOUT_TOP_AGENT_BONUS_BPS,
    });
    const feeBps = BigInt(this.env.PAYOUT_FEE_BPS);
    let payoutCount = 0;
    let totalGrossUnits = 0n;
    let totalFeeUnits = 0n;
    let totalNetUnits = 0n;

    for (const position of settlementPlan.positions) {
      if (!position.is_winner || position.gross_units <= 0n) {
        continue;
      }

      const feeUnits = (position.gross_units * feeBps) / BPS_DENOMINATOR;
      const netUnits = position.gross_units - feeUnits;
      const existingPayout = await queryOne<{ id: string }>(
        client,
        `
          SELECT id
          FROM payouts
          WHERE market_id = $1
            AND wallet_identity_id = $2
            AND market_agent_id = $3
          ORDER BY created_at DESC
          LIMIT 1
        `,
        [market.id, position.wallet_identity_id, position.market_agent_id],
      );
      const payoutId =
        existingPayout?.id ??
        createStableId(
          "payout",
          `${market.id}:${position.wallet_identity_id}:${position.market_agent_id}`,
        );

      await client.query(
        `
          INSERT INTO payouts (
            id,
            wallet_identity_id,
            market_id,
            market_agent_id,
            gross_usdc,
            fee_usdc,
            net_usdc,
            payout_tx_sig,
            status,
            paid_at,
            created_at,
            updated_at
          ) VALUES (
            $1, $2, $3, $4, $5::numeric, $6::numeric, $7::numeric,
            NULL, 'claimable', NULL, now(), now()
          )
          ON CONFLICT (id) DO UPDATE
          SET
            gross_usdc = excluded.gross_usdc,
            fee_usdc = excluded.fee_usdc,
            net_usdc = excluded.net_usdc,
            payout_tx_sig = CASE
              WHEN payouts.status = 'paid' THEN payouts.payout_tx_sig
              ELSE excluded.payout_tx_sig
            END,
            status = CASE
              WHEN payouts.status = 'paid' THEN payouts.status
              ELSE excluded.status
            END,
            paid_at = CASE
              WHEN payouts.status = 'paid' THEN payouts.paid_at
              ELSE excluded.paid_at
            END,
            updated_at = now()
        `,
        [
          payoutId,
          position.wallet_identity_id,
          market.id,
          position.market_agent_id,
          this.formatDecimalUnits(position.gross_units),
          this.formatDecimalUnits(feeUnits),
          this.formatDecimalUnits(netUnits),
        ],
      );

      payoutCount += 1;
      totalGrossUnits += position.gross_units;
      totalFeeUnits += feeUnits;
      totalNetUnits += netUnits;
    }

    const settledPositions = await client.query(
      `
        UPDATE user_positions
        SET status = 'settled', updated_at = now()
        WHERE market_id = $1 AND status <> 'settled'
      `,
      [market.id],
    );
    await client.query(
      `
        UPDATE market_agents
        SET status = 'settled', updated_at = now()
        WHERE market_id = $1 AND status <> 'settled'
      `,
      [market.id],
    );
    await client.query(
      `
        UPDATE markets
        SET
          status = 'resolved',
          final_outcome = $4,
          resolves_at = $2,
          resolver_wallet_identity_id = COALESCE(resolver_wallet_identity_id, $3),
          final_liquidity_usdc = COALESCE(final_liquidity_usdc, total_liquidity_usdc),
          updated_at = now()
        WHERE id = $1
      `,
      [market.id, resolvedAt, input.submittedByWalletId ?? null, input.outcome],
    );

    return {
      oracle_result_id: oracleResultId,
      outcome: input.outcome,
      resolved_at: resolvedAt,
      fee_bps: this.env.PAYOUT_FEE_BPS,
      top_agent_bonus_bps: this.env.PAYOUT_TOP_AGENT_BONUS_BPS,
      position_count: positions.reduce(
        (total, position) => total + Number(position.position_count),
        0,
      ),
      positions_updated: Number(settledPositions.rowCount ?? 0),
      winning_stake_usdc: this.formatDecimalUnits(
        settlementPlan.winning_stake_units,
      ),
      losing_stake_usdc: this.formatDecimalUnits(
        settlementPlan.losing_stake_units,
      ),
      base_prize_pool_usdc: this.formatDecimalUnits(
        settlementPlan.base_prize_pool_units,
      ),
      top_agent_bonus_pool_usdc: this.formatDecimalUnits(
        settlementPlan.top_agent_bonus_pool_units,
      ),
      top_ranked_market_agent_ids: settlementPlan.top_ranked_market_agent_ids,
      payout_count: payoutCount,
      total_gross_usdc: this.formatDecimalUnits(totalGrossUnits),
      total_fee_usdc: this.formatDecimalUnits(totalFeeUnits),
      total_net_usdc: this.formatDecimalUnits(totalNetUnits),
    };
  }

  private async updateMarket(
    marketIdOrSlug: string,
    input: Partial<MarketMutationInput>,
    replace: boolean,
  ) {
    const client = await this.db.connect();

    try {
      await client.query("BEGIN");

      const existing = await this.requireManagedMarket(marketIdOrSlug, client);
      if (!replace && input.category && !input.topicSlugs) {
        throw new HttpError(
          400,
          "TOPICS_REQUIRED_FOR_CATEGORY_CHANGE",
          "topic_slugs must be provided when changing a market category.",
        );
      }

      const category = input.category
        ? await this.requireCategory(input.category, client)
        : await this.requireCategory(existing.category_id, client);
      const topicSlugs = replace
        ? input.topicSlugs
        : (input.topicSlugs ??
          (await this.getMarketTopicSlugs(existing.id, client)));
      if (!topicSlugs) {
        throw new HttpError(
          400,
          "TOPICS_REQUIRED",
          "topic_slugs is required for this request.",
        );
      }

      const topicRows = await this.requireTopics(
        category.id,
        topicSlugs,
        client,
      );
      const resolverWallet = replace
        ? (input.resolverWallet ?? null)
        : Object.prototype.hasOwnProperty.call(input, "resolverWallet")
          ? (input.resolverWallet ?? null)
          : undefined;
      const resolverIdentity =
        resolverWallet === undefined
          ? null
          : resolverWallet
            ? await this.ensureWalletIdentity(resolverWallet, client)
            : null;
      const title = (
        replace ? input.title : (input.title ?? existing.title)
      )?.trim();
      const shortDescription = (
        replace
          ? input.shortDescription
          : (input.shortDescription ?? existing.short_description)
      )?.trim();
      const description = (
        replace
          ? input.description
          : (input.description ?? existing.description)
      )?.trim();
      const imageUri = replace
        ? (input.imageUri ?? null)
        : (input.imageUri ?? existing.image_uri);
      const status = replace ? input.status : (input.status ?? existing.status);
      const oracleSource = (
        replace
          ? input.oracleSource
          : (input.oracleSource ?? existing.oracle_source)
      )?.trim();
      const settlementAsset = (
        replace
          ? input.settlementAsset
          : (input.settlementAsset ?? existing.settlement_asset)
      )?.trim();
      const opensAt = replace
        ? input.opensAt
        : (input.opensAt ?? existing.opens_at);
      const decisionCutoffAt = replace
        ? input.decisionCutoffAt
        : (input.decisionCutoffAt ?? existing.decision_cutoff_at);
      const closesAt = replace
        ? input.closesAt
        : (input.closesAt ?? existing.closes_at);
      const resolvesAt = replace
        ? (input.resolvesAt ?? null)
        : (input.resolvesAt ?? existing.resolves_at);
      const totalLiquidityUsdc = replace
        ? input.totalLiquidityUsdc
        : (input.totalLiquidityUsdc ?? existing.total_liquidity_usdc);
      const finalLiquidityUsdc = replace
        ? (input.finalLiquidityUsdc ?? null)
        : (input.finalLiquidityUsdc ?? existing.final_liquidity_usdc);
      const rulesJson = replace
        ? (input.rules ?? [])
        : (input.rules ?? existing.rules_json);
      const contextJson = replace
        ? (input.context ?? {})
        : (input.context ?? existing.context_json);

      if (
        !title ||
        !shortDescription ||
        !description ||
        !status ||
        !oracleSource ||
        !settlementAsset
      ) {
        throw new HttpError(
          400,
          "INVALID_MARKET_PAYLOAD",
          "Required market fields are missing.",
        );
      }

      if (!opensAt || !decisionCutoffAt || !closesAt || !totalLiquidityUsdc) {
        throw new HttpError(
          400,
          "INVALID_MARKET_TIMING",
          "Market timing and liquidity fields are required.",
        );
      }

      const shouldRecalculateJoinDeadline =
        replace ||
        input.opensAt !== undefined ||
        input.decisionCutoffAt !== undefined ||
        input.closesAt !== undefined ||
        input.resolvesAt !== undefined;
      const joinDeadlineAt =
        input.joinDeadlineAt ??
        (shouldRecalculateJoinDeadline
          ? this.buildDefaultJoinDeadlineAt(
              opensAt,
              decisionCutoffAt,
              closesAt,
              resolvesAt,
            )
          : existing.join_deadline_at);

      const slug = replace
        ? this.ensureMarketSlug(input.slug ?? title)
        : input.slug
          ? this.ensureMarketSlug(input.slug)
          : existing.slug;

      this.assertMarketTiming(
        opensAt,
        joinDeadlineAt,
        decisionCutoffAt,
        closesAt,
        resolvesAt,
      );

      if (
        existing.onchain_market_pubkey &&
        hasPublishedMarketTimingChange(
          {
            opensAt: existing.opens_at,
            joinDeadlineAt: existing.join_deadline_at,
            decisionCutoffAt: existing.decision_cutoff_at,
            closesAt: existing.closes_at,
            resolvesAt: existing.resolves_at,
          },
          {
            opensAt,
            joinDeadlineAt,
            decisionCutoffAt,
            closesAt,
            resolvesAt,
          },
        )
      ) {
        throw new HttpError(
          409,
          "ONCHAIN_MARKET_TIMING_IMMUTABLE",
          "This market has already been published on-chain, so its timing cannot be changed. Create a new market instead.",
        );
      }

      await client.query(
        `
          UPDATE markets
          SET
            slug = $2,
            onchain_market_pubkey = $3,
            image_uri = $4,
            title = $5,
            short_description = $6,
            description = $7,
            category_id = $8,
            status = $9,
            oracle_source = $10,
            settlement_asset = $11,
            opens_at = $12,
            join_deadline_at = $13,
            decision_cutoff_at = $14,
            cutoff_at = $14,
            closes_at = $15,
            resolves_at = $16,
            total_liquidity_usdc = $17,
            final_liquidity_usdc = $18,
            resolver_wallet_identity_id = $19,
            rules_json = $20::jsonb,
            context_json = $21::jsonb,
            updated_at = now()
          WHERE id = $1
        `,
        [
          existing.id,
          slug,
          replace
            ? (input.onchainMarketPubkey ?? null)
            : (input.onchainMarketPubkey ?? existing.onchain_market_pubkey),
          imageUri,
          title,
          shortDescription,
          description,
          category.id,
          status,
          oracleSource,
          settlementAsset,
          opensAt,
          joinDeadlineAt,
          decisionCutoffAt,
          closesAt,
          resolvesAt,
          totalLiquidityUsdc,
          finalLiquidityUsdc,
          resolverWallet === undefined
            ? existing.resolver_wallet_identity_id
            : (resolverIdentity?.id ?? null),
          JSON.stringify(rulesJson),
          JSON.stringify(contextJson),
        ],
      );

      await this.syncMarketTopics(client, existing.id, topicRows);
      await client.query("COMMIT");

      return this.requireMarketDetailView(existing.id);
    } catch (error) {
      await client.query("ROLLBACK");
      if (isPgErrorCode(error, "23505")) {
        throw new HttpError(
          409,
          "MARKET_SLUG_CONFLICT",
          "A market with that slug already exists.",
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
    const category = await queryOne<{ id: string; slug: string }>(
      db,
      `
        SELECT id, slug
        FROM categories
        WHERE (id = $1 OR slug = $2) AND is_active = true
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

  private async ensureWalletIdentity(
    walletAddress: string,
    db: AppDatabase | PoolClient = this.db,
  ) {
    const existing = await queryOne<{ id: string; is_active: boolean }>(
      db,
      `
        SELECT id, is_active
        FROM wallet_identities
        WHERE wallet_address = $1
        LIMIT 1
      `,
      [walletAddress],
    );

    if (existing) {
      if (!existing.is_active) {
        throw new HttpError(
          403,
          "WALLET_DISABLED",
          "This wallet has been disabled.",
        );
      }

      return existing;
    }

    const id = createStableId("wallet", walletAddress);
    await db.query(
      `
        INSERT INTO wallet_identities (id, wallet_address, is_active, created_at, updated_at)
        VALUES ($1, $2, true, now(), now())
      `,
      [id, walletAddress],
    );

    return { id, is_active: true };
  }

  private async requireTopics(
    categoryId: string,
    topicSlugs: string[],
    db: AppDatabase | PoolClient = this.db,
  ) {
    const normalizedSlugs = [
      ...new Set(topicSlugs.map((slug) => slugify(slug)).filter(Boolean)),
    ];
    if (normalizedSlugs.length === 0) {
      throw new HttpError(
        400,
        "INVALID_TOPIC_SELECTION",
        "At least one valid topic slug is required.",
      );
    }

    const rows = await queryRows<TopicLinkRow>(
      db,
      `
        SELECT id, slug
        FROM topics
        WHERE category_id = $1
          AND is_active = true
          AND slug = ANY($2::text[])
      `,
      [categoryId, normalizedSlugs],
    );

    if (rows.length !== normalizedSlugs.length) {
      const foundSlugs = new Set(rows.map((row) => row.slug));
      const missing = normalizedSlugs.filter((slug) => !foundSlugs.has(slug));
      throw new HttpError(
        400,
        "TOPICS_NOT_FOUND",
        `The following topics are invalid for this category: ${missing.join(", ")}.`,
      );
    }

    const rowsBySlug = new Map(rows.map((row) => [row.slug, row]));
    return normalizedSlugs
      .map((slug) => rowsBySlug.get(slug))
      .filter((row): row is TopicLinkRow => Boolean(row));
  }

  private async syncMarketTopics(
    client: PoolClient,
    marketId: string,
    topics: TopicLinkRow[],
  ) {
    await client.query("DELETE FROM market_topics WHERE market_id = $1", [
      marketId,
    ]);

    for (const [index, topic] of topics.entries()) {
      await client.query(
        `
          INSERT INTO market_topics (id, market_id, topic_id, is_primary, created_at, updated_at)
          VALUES ($1, $2, $3, $4, now(), now())
        `,
        [
          createStableId("mt", `${marketId}:${topic.id}`),
          marketId,
          topic.id,
          index === 0,
        ],
      );
    }
  }

  private async requireManagedMarket(
    marketIdOrSlug: string,
    db: AppDatabase | PoolClient = this.db,
  ) {
    const market = await queryOne<ManagedMarketRow>(
      db,
      `
        SELECT
          id,
          slug,
          title,
          short_description,
          description,
          image_uri,
          status,
          onchain_market_pubkey,
          oracle_source,
          resolution_source,
          settlement_asset,
          opens_at::text,
          join_deadline_at::text,
          decision_cutoff_at::text,
          closes_at::text,
          resolves_at::text,
          cutoff_at::text,
          total_liquidity_usdc::text,
          final_liquidity_usdc::text,
          category_id,
          created_by_wallet_identity_id,
          resolver_wallet_identity_id,
          rules_json,
          context_json
        FROM markets
        WHERE id = $1 OR slug = $2
        LIMIT 1
      `,
      [marketIdOrSlug, marketIdOrSlug],
    );

    if (!market) {
      throw new HttpError(
        404,
        "MARKET_NOT_FOUND",
        `Market '${marketIdOrSlug}' was not found.`,
      );
    }

    return market;
  }

  private async lockMarketRow(client: PoolClient, marketId: string) {
    await client.query("SELECT id FROM markets WHERE id = $1 FOR UPDATE", [
      marketId,
    ]);
  }

  private async hasLinkedNewsContext(
    marketId: string,
    contextJson: unknown,
    db: AppDatabase | PoolClient = this.db,
  ) {
    if (getLinkedNewsCountFromContext(contextJson) > 0) {
      return true;
    }

    const row = await queryOne<{ has_linked_news: boolean }>(
      db,
      `
        SELECT EXISTS (
          SELECT 1
          FROM news_item_markets
          WHERE market_id = $1
        ) AS has_linked_news
      `,
      [marketId],
    );

    return Boolean(row?.has_linked_news);
  }

  private async getMarketTopicSlugs(
    marketId: string,
    db: AppDatabase | PoolClient = this.db,
  ) {
    const rows = await queryRows<{ slug: string }>(
      db,
      `
        SELECT t.slug
        FROM market_topics mt
        JOIN topics t ON t.id = mt.topic_id
        WHERE mt.market_id = $1
        ORDER BY mt.is_primary DESC, t.name ASC
      `,
      [marketId],
    );

    return rows.map((row) => row.slug);
  }

  private async requireMarketDetailView(marketId: string) {
    const result = await this.getMarketDetail(marketId);
    if (!result) {
      throw new HttpError(
        404,
        "MARKET_NOT_FOUND",
        `Market '${marketId}' was not found.`,
      );
    }

    return result;
  }

  private ensureMarketSlug(value: string) {
    const slug = slugify(value, {
      maxLength: MAX_MARKET_SLUG_LENGTH,
    });
    if (!slug) {
      throw new HttpError(
        400,
        "INVALID_MARKET_SLUG",
        "A valid market slug could not be generated.",
      );
    }

    return slug;
  }

  private assertMarketTiming(
    opensAt: string,
    joinDeadlineAt: string,
    decisionCutoffAt: string,
    closesAt: string,
    resolvesAt: string | null,
  ) {
    const { opensAtMs, decisionCutoffAtMs, closesAtMs, resolvesAtMs } =
      this.parseMarketTiming(opensAt, decisionCutoffAt, closesAt, resolvesAt);
    const joinDeadlineAtMs = Date.parse(joinDeadlineAt);

    if (Number.isNaN(joinDeadlineAtMs)) {
      throw new HttpError(
        400,
        "INVALID_MARKET_TIMING",
        "Market timestamps must be valid ISO dates.",
      );
    }

    if (joinDeadlineAtMs < opensAtMs) {
      throw new HttpError(
        400,
        "INVALID_MARKET_TIMING",
        "join_deadline_at must be greater than or equal to opens_at.",
      );
    }

    if (decisionCutoffAtMs < joinDeadlineAtMs) {
      throw new HttpError(
        400,
        "INVALID_MARKET_TIMING",
        "decision_cutoff_at must be greater than or equal to join_deadline_at.",
      );
    }

    if (decisionCutoffAtMs < opensAtMs) {
      throw new HttpError(
        400,
        "INVALID_MARKET_TIMING",
        "decision_cutoff_at must be greater than or equal to opens_at.",
      );
    }

    if (closesAtMs < decisionCutoffAtMs) {
      throw new HttpError(
        400,
        "INVALID_MARKET_TIMING",
        "closes_at must be greater than or equal to decision_cutoff_at.",
      );
    }

    if (resolvesAtMs !== null && Number.isNaN(resolvesAtMs)) {
      throw new HttpError(
        400,
        "INVALID_MARKET_TIMING",
        "resolves_at must be a valid ISO date.",
      );
    }

    if (resolvesAtMs !== null && resolvesAtMs < closesAtMs) {
      throw new HttpError(
        400,
        "INVALID_MARKET_TIMING",
        "resolves_at must be greater than or equal to closes_at.",
      );
    }
  }

  private buildDefaultJoinDeadlineAt(
    opensAt: string,
    decisionCutoffAt: string,
    closesAt: string,
    resolvesAt: string | null,
  ) {
    return buildConfiguredJoinDeadlineAt({
      opensAt,
      decisionCutoffAt,
      closesAt,
      resolvesAt,
      config: {
        joinWindowRatio: this.env.MARKET_DEFAULT_JOIN_WINDOW_RATIO,
        minJoinWindowHours: this.env.MARKET_DEFAULT_MIN_JOIN_WINDOW_HOURS,
        maxJoinWindowHours: this.env.MARKET_DEFAULT_MAX_JOIN_WINDOW_HOURS,
      },
    });
  }

  private parseMarketTiming(
    opensAt: string,
    decisionCutoffAt: string,
    closesAt: string,
    resolvesAt: string | null,
  ) {
    const opensAtMs = Date.parse(opensAt);
    const decisionCutoffAtMs = Date.parse(decisionCutoffAt);
    const closesAtMs = Date.parse(closesAt);
    const resolvesAtMs = resolvesAt ? Date.parse(resolvesAt) : null;

    if (
      [opensAtMs, decisionCutoffAtMs, closesAtMs].some((value) =>
        Number.isNaN(value),
      )
    ) {
      throw new HttpError(
        400,
        "INVALID_MARKET_TIMING",
        "Market timestamps must be valid ISO dates.",
      );
    }

    if (resolvesAtMs !== null && Number.isNaN(resolvesAtMs)) {
      throw new HttpError(
        400,
        "INVALID_MARKET_TIMING",
        "resolves_at must be a valid ISO date.",
      );
    }

    return {
      opensAtMs,
      decisionCutoffAtMs,
      closesAtMs,
      resolvesAtMs,
    };
  }

  private isJoinWindowClosed(joinDeadlineAt: string) {
    const joinDeadlineAtMs = Date.parse(joinDeadlineAt);
    if (Number.isNaN(joinDeadlineAtMs)) {
      return false;
    }

    return Date.now() >= joinDeadlineAtMs;
  }

  private areLiveAgentDecisionsVisible(joinDeadlineAt: string) {
    if (!this.env.MARKET_HIDE_LIVE_AGENT_DECISIONS_UNTIL_JOIN_DEADLINE) {
      return true;
    }

    return this.isJoinWindowClosed(joinDeadlineAt);
  }

  private parseDecimalUnits(value: string, fieldName: string) {
    const normalized = value.trim();
    if (!/^\d+(\.\d+)?$/.test(normalized)) {
      throw new HttpError(
        500,
        "INVALID_DECIMAL_VALUE",
        `${fieldName} contains an invalid decimal value.`,
      );
    }

    const parts = normalized.split(".");
    const wholePart = parts[0] ?? "0";
    const fractionalPart = parts[1] ?? "";
    if (fractionalPart.length > DECIMAL_PLACES) {
      throw new HttpError(
        500,
        "DECIMAL_SCALE_UNSUPPORTED",
        `${fieldName} has more than ${DECIMAL_PLACES} decimal places.`,
      );
    }

    return (
      BigInt(wholePart) * DECIMAL_SCALE +
      BigInt(fractionalPart.padEnd(DECIMAL_PLACES, "0"))
    );
  }

  private formatDecimalUnits(units: bigint) {
    return formatSettlementDecimalUnits(units);
  }

  private toStringArray(value: unknown) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((item): item is string => typeof item === "string");
  }
}

export function isWinningDecisionSide(
  finalDecisionSide: string | null | undefined,
  outcome: MarketOutcome,
) {
  return finalDecisionSide?.trim().toUpperCase() === outcome;
}

export function buildHybridSettlementPlan(input: {
  positions: SettlementPlanPositionInput[];
  outcome: MarketOutcome;
  topAgentBonusBps: number | bigint;
}) {
  const requestedTopAgentBonusBps =
    typeof input.topAgentBonusBps === "bigint"
      ? input.topAgentBonusBps
      : BigInt(input.topAgentBonusBps);
  const topAgentBonusBps =
    requestedTopAgentBonusBps < 0n
      ? 0n
      : requestedTopAgentBonusBps > BPS_DENOMINATOR
        ? BPS_DENOMINATOR
        : requestedTopAgentBonusBps;
  const totalStakeUnits = input.positions.reduce(
    (total, position) => total + position.stakeUnits,
    0n,
  );
  const winningPositions = input.positions.filter(
    (position) =>
      position.stakeUnits > 0n &&
      isWinningDecisionSide(position.final_decision_side, input.outcome),
  );
  const winningStakeUnits = winningPositions.reduce(
    (total, position) => total + position.stakeUnits,
    0n,
  );
  const losingStakeUnits = totalStakeUnits - winningStakeUnits;
  const topAgentBonusPoolUnits =
    winningStakeUnits > 0n
      ? (losingStakeUnits * topAgentBonusBps) / BPS_DENOMINATOR
      : 0n;
  const basePrizePoolUnits = losingStakeUnits - topAgentBonusPoolUnits;
  const basePrizeByPositionKey = allocateUnitsProRata(
    basePrizePoolUnits,
    winningPositions.map((position) => ({
      key: position.payout_key,
      weightUnits: position.stakeUnits,
    })),
  );
  const topRankedMarketAgentIds = getTopRankedWinningMarketAgentIds(
    winningPositions,
    input.outcome,
  );
  const topAgentBonusByAgentId = allocateUnitsProRata(
    topAgentBonusPoolUnits,
    topRankedMarketAgentIds.map((marketAgentId) => ({
      key: marketAgentId,
      weightUnits: 1n,
    })),
  );
  const topAgentBonusByPositionKey = new Map<string, bigint>();

  for (const marketAgentId of topRankedMarketAgentIds) {
    const agentPositions = winningPositions.filter(
      (position) => position.market_agent_id === marketAgentId,
    );
    const agentBonusUnits = topAgentBonusByAgentId.get(marketAgentId) ?? 0n;
    const allocations = allocateUnitsProRata(
      agentBonusUnits,
      agentPositions.map((position) => ({
        key: position.payout_key,
        weightUnits: position.stakeUnits,
      })),
    );

    for (const [key, value] of allocations.entries()) {
      topAgentBonusByPositionKey.set(
        key,
        (topAgentBonusByPositionKey.get(key) ?? 0n) + value,
      );
    }
  }

  const positions = input.positions.map<SettlementPlanPosition>((position) => {
    const isWinner = isWinningDecisionSide(
      position.final_decision_side,
      input.outcome,
    );
    const baseWinningsUnits = isWinner
      ? (basePrizeByPositionKey.get(position.payout_key) ?? 0n)
      : 0n;
    const topAgentBonusUnits = isWinner
      ? (topAgentBonusByPositionKey.get(position.payout_key) ?? 0n)
      : 0n;
    const grossUnits = isWinner
      ? position.stakeUnits + baseWinningsUnits + topAgentBonusUnits
      : 0n;

    return {
      ...position,
      is_winner: isWinner,
      base_winnings_units: baseWinningsUnits,
      top_agent_bonus_units: topAgentBonusUnits,
      gross_units: grossUnits,
    };
  });

  return {
    positions,
    total_stake_units: totalStakeUnits,
    winning_stake_units: winningStakeUnits,
    losing_stake_units: losingStakeUnits,
    base_prize_pool_units: basePrizePoolUnits,
    top_agent_bonus_pool_units: topAgentBonusPoolUnits,
    top_ranked_market_agent_ids: topRankedMarketAgentIds,
  };
}

export function getTopRankedWinningMarketAgentIds(
  positions: Array<{
    market_agent_id: string;
    final_decision_side: string | null;
    decision_confidence: number | null;
  }>,
  outcome: MarketOutcome,
) {
  const scoreByMarketAgentId = new Map<string, number>();

  for (const position of positions) {
    if (!isWinningDecisionSide(position.final_decision_side, outcome)) {
      continue;
    }

    const confidence = clampConfidence(position.decision_confidence);
    const existingScore = scoreByMarketAgentId.get(position.market_agent_id);
    if (existingScore === undefined || confidence > existingScore) {
      scoreByMarketAgentId.set(position.market_agent_id, confidence);
    }
  }

  let topScore = Number.NEGATIVE_INFINITY;
  for (const score of scoreByMarketAgentId.values()) {
    topScore = Math.max(topScore, score);
  }

  if (!Number.isFinite(topScore)) {
    return [];
  }

  return [...scoreByMarketAgentId.entries()]
    .filter(([, score]) => Math.abs(score - topScore) <= Number.EPSILON)
    .map(([marketAgentId]) => marketAgentId)
    .sort((left, right) => left.localeCompare(right));
}

export function allocateUnitsProRata(
  totalUnits: bigint,
  entries: Array<{ key: string; weightUnits: bigint }>,
) {
  const allocations = new Map<string, bigint>();
  for (const entry of entries) {
    allocations.set(entry.key, 0n);
  }

  if (totalUnits <= 0n) {
    return allocations;
  }

  const positiveEntries = entries.filter((entry) => entry.weightUnits > 0n);
  if (positiveEntries.length === 0) {
    return allocations;
  }

  const totalWeightUnits = positiveEntries.reduce(
    (total, entry) => total + entry.weightUnits,
    0n,
  );
  if (totalWeightUnits <= 0n) {
    return allocations;
  }

  const rows = positiveEntries.map((entry) => {
    const weightedUnits = totalUnits * entry.weightUnits;
    const allocatedUnits = weightedUnits / totalWeightUnits;
    const remainderUnits = weightedUnits % totalWeightUnits;
    return {
      key: entry.key,
      allocatedUnits,
      remainderUnits,
    };
  });
  const allocatedTotalUnits = rows.reduce(
    (total, row) => total + row.allocatedUnits,
    0n,
  );
  let leftoverUnits = totalUnits - allocatedTotalUnits;

  rows.sort((left, right) => {
    if (left.remainderUnits === right.remainderUnits) {
      return left.key.localeCompare(right.key);
    }

    return left.remainderUnits > right.remainderUnits ? -1 : 1;
  });

  for (const row of rows) {
    const bonusUnit = leftoverUnits > 0n ? 1n : 0n;
    allocations.set(row.key, row.allocatedUnits + bonusUnit);
    if (leftoverUnits > 0n) {
      leftoverUnits -= 1n;
    }
  }

  return allocations;
}

export function buildHybridPayoutBreakdownByPositionKey(input: {
  positions: Array<{
    payout_key: string;
    wallet_identity_id: string;
    market_agent_id: string;
    final_decision_side: string | null;
    decision_confidence: number | null;
    decision_recorded_at: string | null;
    stakeUnits: bigint;
    position_count: number;
  }>;
  outcome: MarketOutcome;
  topAgentBonusBps: number | bigint;
  payoutFeeBps: number | bigint;
}) {
  const payoutFeeBps =
    typeof input.payoutFeeBps === "bigint"
      ? input.payoutFeeBps
      : BigInt(input.payoutFeeBps);
  const settlementPlan = buildHybridSettlementPlan({
    positions: input.positions,
    outcome: input.outcome,
    topAgentBonusBps: input.topAgentBonusBps,
  });
  const breakdownByPositionKey = new Map<
    string,
    {
      principal_units: bigint;
      base_pool_winnings_units: bigint;
      top_agent_bonus_units: bigint;
      gross_units: bigint;
      fee_units: bigint;
      net_units: bigint;
    }
  >();

  for (const position of settlementPlan.positions) {
    if (!position.is_winner || position.gross_units <= 0n) {
      continue;
    }

    const feeUnits = (position.gross_units * payoutFeeBps) / BPS_DENOMINATOR;
    const netUnits = position.gross_units - feeUnits;
    breakdownByPositionKey.set(position.payout_key, {
      principal_units: position.stakeUnits,
      base_pool_winnings_units: position.base_winnings_units,
      top_agent_bonus_units: position.top_agent_bonus_units,
      gross_units: position.gross_units,
      fee_units: feeUnits,
      net_units: netUnits,
    });
  }

  return {
    settlementPlan,
    breakdownByPositionKey,
  };
}

export function formatSettlementDecimalUnits(units: bigint) {
  const sign = units < 0n ? "-" : "";
  const absoluteUnits = units < 0n ? -units : units;
  const wholePart = absoluteUnits / DECIMAL_SCALE;
  const fractionalPart = (absoluteUnits % DECIMAL_SCALE)
    .toString()
    .padStart(DECIMAL_PLACES, "0")
    .replace(/0+$/, "");

  return fractionalPart
    ? `${sign}${wholePart.toString()}.${fractionalPart}`
    : `${sign}${wholePart.toString()}`;
}

function getLinkedNewsCountFromContext(contextJson: unknown) {
  if (!contextJson || typeof contextJson !== "object") {
    return 0;
  }

  const linkedNews = (contextJson as { linked_news?: unknown }).linked_news;
  return Array.isArray(linkedNews) ? linkedNews.length : 0;
}

function clampConfidence(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
}

function isMarketOutcome(
  value: string | null | undefined,
): value is MarketOutcome {
  return value === "YES" || value === "NO";
}

function getMarketCreatedByActorLabel(value: string | null | undefined) {
  switch (value) {
    case "ai_generator":
      return "AI Generator";
    case "system":
      return "System";
    case "admin":
      return "Admin";
    default:
      return null;
  }
}

function getMarketResolverActorLabel(oracleSource: string | null | undefined) {
  switch (oracleSource?.trim()) {
    case "exoduze_topic_snapshots":
      return "AI Oracle";
    case "manual":
      return "Manual Resolver";
    default:
      return oracleSource ? formatTextActorLabel(oracleSource) : null;
  }
}

function formatTextActorLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
