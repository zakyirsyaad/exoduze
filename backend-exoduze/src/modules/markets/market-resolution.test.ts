import assert from "node:assert/strict";
import test from "node:test";

import { MAX_MARKET_SLUG_LENGTH } from "../../lib/ids.js";
import {
  AUTOMATIC_MARKET_DURATION_HOURS,
  buildAutomaticCutoffAt,
  buildMarketHeadline,
  buildTopicNewsContext,
  buildMarketTitle,
  buildResolutionDescription,
  generateMarketDrafts,
} from "./market-generator.js";
import { buildConfiguredJoinDeadlineAt } from "./market-join-window.js";
import {
  allocateUnitsProRata,
  buildHybridSettlementPlan,
  buildHybridPayoutBreakdownByPositionKey,
  getTopRankedWinningMarketAgentIds,
  isWinningDecisionSide as isWinningSettlementDecisionSide,
} from "./markets.service.js";
import {
  determineOracleOutcome,
  isActiveResolutionStatus,
} from "./oracle-resolver.js";
import { isResolutionFinalizable } from "./resolution-finalizer.js";
import {
  getTopicRankFromSnapshot,
  isDevTopicSnapshot,
  type TopicSnapshotRecord,
} from "../topics/topic-snapshots.js";

const futureOpen = "2099-04-26T03:26:00.000Z";
const futureCutoff = "2099-04-27T03:26:00.000Z";
const snapshot: TopicSnapshotRecord = {
  id: "tsnap_test",
  category: "finance",
  generated_at: "2099-04-27T03:27:10.000Z",
  window_hours: 24,
  source_count: 5,
  topics: [
    { rank: 1, name: "Rates", slug: "rates", score: 95 },
    { rank: 2, name: "Stocks", slug: "stocks", score: 88 },
    { rank: 4, name: "Crypto", slug: "crypto", score: 64 },
  ],
  raw_payload: null,
  created_at: "2099-04-27T03:27:10.000Z",
};

test("market title generation uses the required deterministic format", () => {
  const title = buildMarketTitle({
    topicName: "Stocks",
    categoryName: "Finance",
    requiredRank: 3,
    cutoffAt: futureCutoff,
    newsContext: [
      {
        id: "news_1",
        title:
          "Stocks jump after earnings beat sparks fresh Wall Street optimism",
        summary: null,
        url: "https://example.com/stocks-earnings",
        sourceName: "Example News",
        publishedAt: "2099-04-26T20:00:00.000Z",
        isBreaking: false,
        relevanceScore: 1,
      },
    ],
  });

  assert.equal(title.startsWith("Will Stocks stay in focus through"), true);
  assert.equal(title.includes("earnings beat"), true);
  assert.equal(title.includes("top 3"), false);
  assert.equal(title.endsWith("?"), true);
});

test("market headline generation explains the AI competition clearly", () => {
  const headline = buildMarketHeadline({
    topicName: "Stocks",
    categoryName: "Finance",
    requiredRank: 3,
    cutoffAt: futureCutoff,
  });

  assert.equal(
    headline.startsWith("AI agents are predicting whether Stocks"),
    true,
  );
  assert.equal(headline.includes("2099-04-27 03:26 UTC"), true);
});

test("market generation skips duplicate slugs", () => {
  const title = buildMarketTitle({
    topicName: "Stocks",
    categoryName: "Finance",
    requiredRank: 3,
    cutoffAt: futureCutoff,
  });

  const drafts = generateMarketDrafts({
    category: "finance",
    opensAt: futureOpen,
    requiredRank: 3,
    topics: [{ rank: 2, name: "Stocks", slug: "stocks", score: 88 }],
    existingSlugs: new Set([
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .replace(/-{2,}/g, "-"),
    ]),
  });

  assert.equal(drafts.length, 0);
});

test("automatic generated market slugs stay within the backend route limit", () => {
  const drafts = generateMarketDrafts({
    category: "finance",
    opensAt: futureOpen,
    requiredRank: 3,
    topics: [{ rank: 2, name: "Rates", slug: "rates", score: 88 }],
    newsByTopicSlug: new Map([
      [
        "rates",
        [
          {
            id: "news_long_slug",
            title:
              "Texas Tech transfer QB Brendan Sorsby leaves school, enters gambling rehab after long week of market-moving headlines",
            summary: null,
            url: "https://example.com/rates-long-headline",
            sourceName: "Example News",
            publishedAt: "2099-04-26T20:00:00.000Z",
            isBreaking: true,
            relevanceScore: 1,
          },
        ],
      ],
    ]),
  });

  assert.equal(Boolean(drafts[0]?.slug), true);
  assert.equal((drafts[0]?.slug.length ?? 0) <= MAX_MARKET_SLUG_LENGTH, true);
});

test("automatic generated market cutoff stays 24 hours after open", () => {
  assert.equal(AUTOMATIC_MARKET_DURATION_HOURS, 24);
  assert.equal(buildAutomaticCutoffAt(futureOpen), futureCutoff);

  const drafts = generateMarketDrafts({
    category: "finance",
    opensAt: futureOpen,
    requiredRank: 3,
    topics: [{ rank: 2, name: "Stocks", slug: "stocks", score: 88 }],
  });

  assert.equal(drafts[0]?.opensAt, futureOpen);
  assert.equal(drafts[0]?.cutoffAt, futureCutoff);
  assert.equal(
    drafts[0]?.shortDescription.includes(
      "AI agents are predicting whether Stocks",
    ),
    true,
  );
  assert.equal(
    drafts[0]?.description.includes(
      "Resolve YES if Stocks appears within the top 3",
    ),
    true,
  );
  assert.equal(
    drafts[0]?.description.includes("Resolve NO if Stocks ranks below #3"),
    true,
  );
  assert.deepEqual(drafts[0]?.resolutionCriteria, [
    "Use the first valid Exoduze 24-hour Finance topic snapshot generated after 2099-04-27 03:26 UTC.",
    "Resolve YES only if Stocks appears at rank #3 or better in that snapshot.",
    "Resolve NO if Stocks is ranked below #3 or does not appear at all.",
    "News headlines provide context for why the topic is hot, but they do not override the snapshot ranking result.",
  ]);
});

test("resolution description stays explicit even when the title is news-led", () => {
  const description = buildResolutionDescription({
    topicName: "Stocks",
    categoryName: "Finance",
    requiredRank: 3,
    cutoffAt: futureCutoff,
    newsContext: [
      {
        id: "news_2",
        title: "Stocks roar higher as central bank rate-cut hopes return",
        summary:
          "Traders are rotating back into equities after softer inflation data.",
        url: "https://example.com/stocks-rally",
        sourceName: "Example News",
        publishedAt: "2099-04-26T22:00:00.000Z",
        isBreaking: true,
        relevanceScore: 1,
      },
    ],
  });

  assert.equal(
    description.includes("Resolve YES if Stocks appears within the top 3"),
    true,
  );
  assert.equal(
    description.includes("Resolve NO if Stocks ranks below #3"),
    true,
  );
  assert.equal(
    description.includes("central bank rate-cut hopes return"),
    true,
  );
});

test("topic news context keeps summary-matched stories when the title is generic", () => {
  const news = buildTopicNewsContext(
    [
      {
        id: "news_generic_summary",
        title: "Esports org weighs major roster move before the next event",
        summary:
          "The plan centers on Valorant ahead of a busy tournament schedule.",
        url: "https://example.com/esports-roster",
        source_name: "Example News",
        published_at: "2099-04-26T21:00:00.000Z",
        is_breaking: false,
        relevance_score: 0.8,
        is_primary: true,
      },
    ],
    {
      name: "Valorant",
      slug: "valorant",
    },
  );

  assert.equal(news.length, 1);
  assert.equal(news[0]?.id, "news_generic_summary");
});

test("topic news context falls back to linked topic news when keyword filtering finds nothing", () => {
  const news = buildTopicNewsContext(
    [
      {
        id: "news_topic_link_only",
        title: "Roster chaos builds before the playoffs",
        summary: "A major esports team is reshuffling ahead of the weekend.",
        url: "https://example.com/playoffs-roster-chaos",
        source_name: "Example News",
        published_at: "2099-04-26T22:00:00.000Z",
        is_breaking: true,
        relevance_score: 1,
        is_primary: true,
      },
    ],
    {
      name: "Valorant",
      slug: "valorant",
    },
  );

  assert.equal(news.length, 1);
  assert.equal(news[0]?.id, "news_topic_link_only");
});

test("automatic market join window respects configured defaults", () => {
  assert.equal(
    buildConfiguredJoinDeadlineAt({
      opensAt: futureOpen,
      decisionCutoffAt: futureCutoff,
      closesAt: futureCutoff,
      resolvesAt: null,
      config: {
        joinWindowRatio: 0.25,
        minJoinWindowHours: 6,
        maxJoinWindowHours: 24,
      },
    }),
    "2099-04-26T09:26:00.000Z",
  );
});

test("settlement treats ABSTAIN and missing decision sides as losing stake", () => {
  assert.equal(isWinningSettlementDecisionSide("YES", "YES"), true);
  assert.equal(isWinningSettlementDecisionSide("NO", "YES"), false);
  assert.equal(isWinningSettlementDecisionSide("ABSTAIN", "YES"), false);
  assert.equal(isWinningSettlementDecisionSide(null, "NO"), false);
});

test("backend settlement matches contract pure pro-rata payout when bonus is disabled", () => {
  const plan = buildHybridSettlementPlan({
    positions: [
      {
        payout_key: "wallet_a:agent_yes_a",
        wallet_identity_id: "wallet_a",
        market_agent_id: "agent_yes_a",
        final_decision_side: "YES",
        decision_confidence: 0.9,
        decision_recorded_at: "2099-04-26T01:00:00.000Z",
        stakeUnits: 30n,
        position_count: 1,
      },
      {
        payout_key: "wallet_b:agent_yes_b",
        wallet_identity_id: "wallet_b",
        market_agent_id: "agent_yes_b",
        final_decision_side: "YES",
        decision_confidence: 0.6,
        decision_recorded_at: "2099-04-26T01:05:00.000Z",
        stakeUnits: 20n,
        position_count: 1,
      },
      {
        payout_key: "wallet_c:agent_no",
        wallet_identity_id: "wallet_c",
        market_agent_id: "agent_no",
        final_decision_side: "NO",
        decision_confidence: 0.8,
        decision_recorded_at: "2099-04-26T01:10:00.000Z",
        stakeUnits: 50n,
        position_count: 1,
      },
    ],
    outcome: "YES",
    topAgentBonusBps: 0,
  });

  const byKey = new Map(
    plan.positions.map((position) => [position.payout_key, position]),
  );

  assert.equal(plan.total_stake_units, 100n);
  assert.equal(plan.winning_stake_units, 50n);
  assert.equal(plan.top_agent_bonus_pool_units, 0n);
  assert.equal(byKey.get("wallet_a:agent_yes_a")?.gross_units, 60n);
  assert.equal(byKey.get("wallet_b:agent_yes_b")?.gross_units, 40n);
  assert.equal(byKey.get("wallet_c:agent_no")?.gross_units, 0n);
});

test("settlement bonus picks the highest-confidence winning AI", () => {
  const plan = buildHybridSettlementPlan({
    positions: [
      {
        payout_key: "wallet_a:agent_yes_top",
        wallet_identity_id: "wallet_a",
        market_agent_id: "agent_yes_top",
        final_decision_side: "YES",
        decision_confidence: 0.9,
        decision_recorded_at: "2099-04-26T01:00:00.000Z",
        stakeUnits: 30n,
        position_count: 1,
      },
      {
        payout_key: "wallet_b:agent_yes_other",
        wallet_identity_id: "wallet_b",
        market_agent_id: "agent_yes_other",
        final_decision_side: "YES",
        decision_confidence: 0.6,
        decision_recorded_at: "2099-04-26T01:05:00.000Z",
        stakeUnits: 20n,
        position_count: 1,
      },
      {
        payout_key: "wallet_c:agent_no",
        wallet_identity_id: "wallet_c",
        market_agent_id: "agent_no",
        final_decision_side: "NO",
        decision_confidence: 0.8,
        decision_recorded_at: "2099-04-26T01:10:00.000Z",
        stakeUnits: 50n,
        position_count: 1,
      },
    ],
    outcome: "YES",
    topAgentBonusBps: 2000,
  });

  assert.equal(plan.winning_stake_units, 50n);
  assert.equal(plan.losing_stake_units, 50n);
  assert.equal(plan.base_prize_pool_units, 40n);
  assert.equal(plan.top_agent_bonus_pool_units, 10n);
  assert.deepEqual(plan.top_ranked_market_agent_ids, ["agent_yes_top"]);

  const byKey = new Map(
    plan.positions.map((position) => [position.payout_key, position]),
  );
  assert.equal(byKey.get("wallet_a:agent_yes_top")?.gross_units, 64n);
  assert.equal(byKey.get("wallet_a:agent_yes_top")?.top_agent_bonus_units, 10n);
  assert.equal(byKey.get("wallet_b:agent_yes_other")?.gross_units, 36n);
  assert.equal(
    byKey.get("wallet_b:agent_yes_other")?.top_agent_bonus_units,
    0n,
  );
  assert.equal(byKey.get("wallet_c:agent_no")?.gross_units, 0n);
});

test("settlement bonus splits equally across tied top-ranked winning agents", () => {
  const plan = buildHybridSettlementPlan({
    positions: [
      {
        payout_key: "wallet_a:agent_yes_a",
        wallet_identity_id: "wallet_a",
        market_agent_id: "agent_yes_a",
        final_decision_side: "YES",
        decision_confidence: 0.8,
        decision_recorded_at: "2099-04-26T01:00:00.000Z",
        stakeUnits: 10n,
        position_count: 1,
      },
      {
        payout_key: "wallet_b:agent_yes_b",
        wallet_identity_id: "wallet_b",
        market_agent_id: "agent_yes_b",
        final_decision_side: "YES",
        decision_confidence: 0.8,
        decision_recorded_at: "2099-04-26T01:05:00.000Z",
        stakeUnits: 10n,
        position_count: 1,
      },
      {
        payout_key: "wallet_c:agent_no",
        wallet_identity_id: "wallet_c",
        market_agent_id: "agent_no",
        final_decision_side: "NO",
        decision_confidence: 0.9,
        decision_recorded_at: "2099-04-26T01:10:00.000Z",
        stakeUnits: 10n,
        position_count: 1,
      },
    ],
    outcome: "YES",
    topAgentBonusBps: 2000,
  });

  assert.deepEqual(plan.top_ranked_market_agent_ids, [
    "agent_yes_a",
    "agent_yes_b",
  ]);

  const byKey = new Map(
    plan.positions.map((position) => [position.payout_key, position]),
  );
  assert.equal(byKey.get("wallet_a:agent_yes_a")?.top_agent_bonus_units, 1n);
  assert.equal(byKey.get("wallet_b:agent_yes_b")?.top_agent_bonus_units, 1n);
  assert.equal(
    plan.positions.reduce(
      (total, position) => total + position.gross_units,
      0n,
    ),
    30n,
  );
});

test("payout breakdown exposes principal, bonus, fee, and net amounts", () => {
  const payoutBreakdown = buildHybridPayoutBreakdownByPositionKey({
    positions: [
      {
        payout_key: "wallet_a:agent_yes_top",
        wallet_identity_id: "wallet_a",
        market_agent_id: "agent_yes_top",
        final_decision_side: "YES",
        decision_confidence: 0.9,
        decision_recorded_at: "2099-04-26T01:00:00.000Z",
        stakeUnits: 30n,
        position_count: 1,
      },
      {
        payout_key: "wallet_b:agent_yes_other",
        wallet_identity_id: "wallet_b",
        market_agent_id: "agent_yes_other",
        final_decision_side: "YES",
        decision_confidence: 0.6,
        decision_recorded_at: "2099-04-26T01:05:00.000Z",
        stakeUnits: 20n,
        position_count: 1,
      },
      {
        payout_key: "wallet_c:agent_no",
        wallet_identity_id: "wallet_c",
        market_agent_id: "agent_no",
        final_decision_side: "NO",
        decision_confidence: 0.8,
        decision_recorded_at: "2099-04-26T01:10:00.000Z",
        stakeUnits: 50n,
        position_count: 1,
      },
    ],
    outcome: "YES",
    topAgentBonusBps: 2000,
    payoutFeeBps: 500,
  });

  assert.deepEqual(
    payoutBreakdown.breakdownByPositionKey.get("wallet_a:agent_yes_top"),
    {
      principal_units: 30n,
      base_pool_winnings_units: 24n,
      top_agent_bonus_units: 10n,
      gross_units: 64n,
      fee_units: 3n,
      net_units: 61n,
    },
  );
});

test("top-ranked winning AI ignores losing-side confidence", () => {
  const topAgents = getTopRankedWinningMarketAgentIds(
    [
      {
        market_agent_id: "agent_yes",
        final_decision_side: "YES",
        decision_confidence: 0.55,
      },
      {
        market_agent_id: "agent_no",
        final_decision_side: "NO",
        decision_confidence: 0.99,
      },
    ],
    "YES",
  );

  assert.deepEqual(topAgents, ["agent_yes"]);
});

test("pro-rata allocator preserves the full pool after rounding", () => {
  const allocations = allocateUnitsProRata(7n, [
    { key: "a", weightUnits: 3n },
    { key: "b", weightUnits: 2n },
    { key: "c", weightUnits: 1n },
  ]);

  assert.equal(
    [...allocations.values()].reduce((total, value) => total + value, 0n),
    7n,
  );
});

test("snapshot rank lookup matches topic slug or name", () => {
  assert.equal(getTopicRankFromSnapshot(snapshot, "stocks"), 2);
  assert.equal(getTopicRankFromSnapshot(snapshot, "Stocks"), 2);
  assert.equal(getTopicRankFromSnapshot(snapshot, "oil"), null);
});

test("oracle outcome is YES when topic rank is inside required rank", () => {
  assert.deepEqual(determineOracleOutcome(snapshot, "stocks", 3), {
    rank: 2,
    outcome: "YES",
  });
});

test("oracle outcome is NO when topic rank is below required rank", () => {
  assert.deepEqual(determineOracleOutcome(snapshot, "crypto", 3), {
    rank: 4,
    outcome: "NO",
  });
});

test("oracle outcome is NO when topic is missing", () => {
  assert.deepEqual(determineOracleOutcome(snapshot, "oil", 3), {
    rank: null,
    outcome: "NO",
  });
});

test("oracle outcome is absent when no snapshot exists", () => {
  assert.equal(determineOracleOutcome(null, "stocks", 3), null);
});

test("topic snapshot helper detects dev seed snapshots", () => {
  assert.equal(
    isDevTopicSnapshot({
      raw_payload: {
        source: "dev_seed",
      },
    }),
    true,
  );
  assert.equal(
    isDevTopicSnapshot({
      raw_payload: {
        source: "hot_topic_snapshots",
      },
    }),
    false,
  );
});

test("active resolution statuses prevent duplicate proposals", () => {
  assert.equal(isActiveResolutionStatus("proposed"), true);
  assert.equal(isActiveResolutionStatus("settling"), true);
  assert.equal(isActiveResolutionStatus("disputed"), true);
  assert.equal(isActiveResolutionStatus("finalized"), true);
  assert.equal(isActiveResolutionStatus("rejected"), false);
});

test("finalizer finalizes after dispute deadline", () => {
  assert.equal(
    isResolutionFinalizable(
      {
        status: "proposed",
        disputeDeadline: "2099-04-27T04:27:10.000Z",
      },
      new Date("2099-04-27T04:27:11.000Z"),
    ),
    true,
  );
});

test("finalizer skips disputed resolution", () => {
  assert.equal(
    isResolutionFinalizable(
      {
        status: "disputed",
        disputeDeadline: "2099-04-27T04:27:10.000Z",
      },
      new Date("2099-04-27T04:27:11.000Z"),
    ),
    false,
  );
});
