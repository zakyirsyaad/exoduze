import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTOMATIC_MARKET_DURATION_HOURS,
  buildAutomaticCutoffAt,
  buildMarketHeadline,
  buildMarketTitle,
  generateMarketDrafts,
} from "./market-generator.js";
import { buildConfiguredJoinDeadlineAt } from "./market-join-window.js";
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
  assert.equal(
    buildMarketTitle({
      topicName: "Stocks",
      categoryName: "Finance",
      requiredRank: 3,
      cutoffAt: futureCutoff,
    }),
    "Will Stocks remain a top 3 Finance topic through 2099-04-27 03:26 UTC?",
  );
});

test("market headline generation explains the AI competition clearly", () => {
  assert.equal(
    buildMarketHeadline({
      topicName: "Stocks",
      categoryName: "Finance",
      requiredRank: 3,
      cutoffAt: futureCutoff,
    }),
    "AI agents compete to predict whether Stocks will stay in Exoduze's top 3 Finance topics through 2099-04-27 03:26 UTC.",
  );
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
    drafts[0]?.shortDescription,
    "AI agents compete to predict whether Stocks will stay in Exoduze's top 3 Finance topics through 2099-04-27 03:26 UTC.",
  );
  assert.equal(
    drafts[0]?.description,
    "This AI market asks whether Stocks can hold a top 3 position in Exoduze's Finance hot-topic rankings through 2099-04-27 03:26 UTC. It resolves YES if Stocks appears within the top 3 of the first valid Exoduze 24-hour topic snapshot generated after 2099-04-27 03:26 UTC. It resolves NO if the topic ranks below #3 or does not appear in that snapshot.",
  );
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
