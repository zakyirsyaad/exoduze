import type { PoolClient } from "pg";

import { env } from "../config/env.js";
import { explainDatabaseConnectionError } from "./connection-error.js";
import { createDatabase, closeDatabase } from "./database.js";

type CleanupStep = {
  label: string;
  countSql: string;
  deleteSql: string;
  params?: unknown[];
};

const seedWalletIds = ["wallet_admin", "wallet_user_1"];
const seedWalletAddresses = [
  "8AdminWalletPubkey111111111111111111111111111",
  "9UserWalletPubkey1111111111111111111111111111"
];
const seedRoleBindingIds = ["role_admin_1", "role_oracle_1"];
const seedAgentIds = ["agt_alpha", "agt_beta", "agt_gamma", "agt_delta"];
const seedAgentCategoryIds = Array.from({ length: 8 }, (_, index) => `agent_cat_${index + 1}`);
const seedPromptArtifactIds = ["prompt_alpha_v12", "prompt_beta_v7", "prompt_gamma_v5", "prompt_delta_v3"];
const seedAgentVersionIds = ["agv_alpha_12", "agv_beta_7", "agv_gamma_5", "agv_delta_3"];
const seedMarketIds = ["mkt_solana_etf_q4", "mkt_fed_cut_sep", "mkt_gpt6_launch", "mkt_us_bill"];
const seedMarketTopicIds = Array.from({ length: 8 }, (_, index) => `market_topic_${index + 1}`);
const seedMarketAgentIds = [
  "ma_solana_alpha",
  "ma_solana_beta",
  "ma_solana_gamma",
  "ma_solana_delta",
  "ma_fed_alpha",
  "ma_fed_gamma",
  "ma_bill_beta",
  "ma_bill_delta"
];
const seedDecisionIds = [
  "d_solana_alpha_1",
  "d_solana_alpha_2",
  "d_solana_alpha_3",
  "d_solana_beta_1",
  "d_solana_beta_2",
  "d_solana_gamma_1",
  "d_solana_gamma_2",
  "d_solana_delta_1",
  "d_solana_delta_2",
  "d_solana_delta_3",
  "d_fed_alpha_1",
  "d_fed_alpha_2",
  "d_fed_alpha_3",
  "d_fed_gamma_1",
  "d_fed_gamma_2",
  "d_bill_beta_1",
  "d_bill_delta_1"
];
const seedPositionIds = ["pos_solana_alpha_user_1", "pos_fed_gamma_user_1"];
const seedOracleResultIds = ["oracle_fed_sep"];
const seedPayoutIds = ["payout_fed_gamma_user_1"];
const seedMonitoringPointIds = ["mon_sol_1", "mon_sol_2", "mon_sol_3"];
const seedLeaderboardFactIds = ["lf_fed_alpha", "lf_fed_gamma"];
const seedLeaderboardSnapshotIds = ["lbs_alpha", "lbs_beta", "lbs_gamma", "lbs_delta"];
const seedNewsItemTopicIds = Array.from({ length: 6 }, (_, index) => `news_topic_${index + 1}`);
const seedNewsItemMarketIds = Array.from({ length: 3 }, (_, index) => `news_market_${index + 1}`);
const seedMentionTimeseriesIds = [
  "mts_solana_prev",
  "mts_solana_curr",
  "mts_etf_prev",
  "mts_etf_curr",
  "mts_policy_prev",
  "mts_policy_curr",
  "mts_cpi_prev",
  "mts_cpi_curr"
];
const seedHotTopicSnapshotIds = ["hot_solana", "hot_etf", "hot_policy", "hot_cpi"];
const seedChainEventIds = ["evt_seed_market_created"];
const seedAuditLogIds = ["audit_seed_publish_agent"];
const seedNewsSourceIds = ["source_newsapi", "source_coingecko"];

const seedNewsCondition = `
  (
    url LIKE 'https://seed.exoduze.dev/%'
    OR external_id LIKE 'seed_%'
    OR raw_payload_json @> '{"seed": true}'::jsonb
  )
`;

const steps: CleanupStep[] = [
  step("auth_sessions for seed wallets", "auth_sessions", "wallet_identity_id = ANY($1::text[])", [seedWalletIds]),
  step("auth_challenges for seed wallets", "auth_challenges", "wallet_address = ANY($1::text[])", [seedWalletAddresses]),
  step("audit seed logs", "audit_logs", "id = ANY($1::text[])", [seedAuditLogIds]),
  step("seed chain events", "chain_events", "id = ANY($1::text[])", [seedChainEventIds]),
  step(
    "seed indexer cursors",
    "indexer_cursors",
    "id = 'cursor_market_program' AND last_signature = 'seed_signature_market_created'"
  ),
  step("seed payouts", "payouts", "id = ANY($1::text[])", [seedPayoutIds]),
  step("seed oracle results", "oracle_results", "id = ANY($1::text[])", [seedOracleResultIds]),
  step("seed user positions", "user_positions", "id = ANY($1::text[]) OR market_id = ANY($2::text[])", [
    seedPositionIds,
    seedMarketIds
  ]),
  step("seed market monitoring points", "market_monitoring_points", "id = ANY($1::text[])", [seedMonitoringPointIds]),
  step("seed leaderboard snapshots", "leaderboard_agent_snapshots", "id = ANY($1::text[])", [
    seedLeaderboardSnapshotIds
  ]),
  step("seed leaderboard facts", "leaderboard_facts", "id = ANY($1::text[])", [seedLeaderboardFactIds]),
  step(
    "seed news-market links",
    "news_item_markets",
    `id = ANY($1::text[]) OR market_id = ANY($2::text[]) OR news_item_id IN (SELECT id FROM news_items WHERE ${seedNewsCondition})`,
    [seedNewsItemMarketIds, seedMarketIds]
  ),
  step(
    "seed news-topic links",
    "news_item_topics",
    `id = ANY($1::text[]) OR news_item_id IN (SELECT id FROM news_items WHERE ${seedNewsCondition})`,
    [seedNewsItemTopicIds]
  ),
  step("seed hot topic snapshots", "hot_topic_snapshots", "id = ANY($1::text[])", [seedHotTopicSnapshotIds]),
  step("seed topic mention timeseries", "topic_mention_timeseries", "id = ANY($1::text[])", [
    seedMentionTimeseriesIds
  ]),
  step("seed agent decisions", "agent_market_decisions", "id = ANY($1::text[]) OR market_agent_id = ANY($2::text[])", [
    seedDecisionIds,
    seedMarketAgentIds
  ]),
  step("seed agent commitments", "agent_commitments", "market_agent_id = ANY($1::text[])", [seedMarketAgentIds]),
  step("seed market agents", "market_agents", "id = ANY($1::text[]) OR market_id = ANY($2::text[])", [
    seedMarketAgentIds,
    seedMarketIds
  ]),
  step("seed market topics", "market_topics", "id = ANY($1::text[]) OR market_id = ANY($2::text[])", [
    seedMarketTopicIds,
    seedMarketIds
  ]),
  step("seed agent secret refs", "agent_secret_refs", "agent_id = ANY($1::text[])", [seedAgentIds]),
  step("seed agent categories", "agent_categories", "id = ANY($1::text[]) OR agent_id = ANY($2::text[])", [
    seedAgentCategoryIds,
    seedAgentIds
  ]),
  step("seed agent versions", "agent_versions", "id = ANY($1::text[]) OR agent_id = ANY($2::text[])", [
    seedAgentVersionIds,
    seedAgentIds
  ]),
  step("seed markets", "markets", "id = ANY($1::text[])", [seedMarketIds]),
  step("seed agents", "agents", "id = ANY($1::text[])", [seedAgentIds]),
  step("seed prompt artifacts", "prompt_artifacts", "id = ANY($1::text[])", [seedPromptArtifactIds]),
  step("seed role bindings", "role_bindings", "id = ANY($1::text[]) OR wallet_identity_id = ANY($2::text[])", [
    seedRoleBindingIds,
    seedWalletIds
  ]),
  step("seed wallets", "wallet_identities", "id = ANY($1::text[])", [seedWalletIds]),
  step("seed news items", "news_items", seedNewsCondition),
  step(
    "unreferenced seed news sources",
    "news_sources",
    `
      id = ANY($1::text[])
      AND NOT EXISTS (
        SELECT 1
        FROM news_items ni
        WHERE ni.source_id = news_sources.id
      )
    `,
    [seedNewsSourceIds]
  )
];

function step(label: string, table: string, where: string, params: unknown[] = []): CleanupStep {
  return {
    label,
    countSql: `SELECT COUNT(*)::int AS count FROM ${table} WHERE ${where}`,
    deleteSql: `DELETE FROM ${table} WHERE ${where}`,
    params
  };
}

async function countRows(client: PoolClient, cleanupStep: CleanupStep) {
  const result = await client.query<{ count: number }>(cleanupStep.countSql, cleanupStep.params ?? []);
  return Number(result.rows[0]?.count ?? 0);
}

async function dryRun(client: PoolClient) {
  let total = 0;

  console.log("Mock data cleanup dry run. Re-run with --apply to delete these rows.");
  for (const cleanupStep of steps) {
    const count = await countRows(client, cleanupStep);
    total += count;
    console.log(`${cleanupStep.label}: ${count}`);
  }

  console.log(`Total targeted rows: ${total}`);
}

async function applyCleanup(client: PoolClient) {
  let total = 0;

  await client.query("BEGIN");
  try {
    for (const cleanupStep of steps) {
      const result = await client.query(cleanupStep.deleteSql, cleanupStep.params ?? []);
      const deleted = result.rowCount ?? 0;
      total += deleted;
      console.log(`${cleanupStep.label}: deleted ${deleted}`);
    }

    await client.query("COMMIT");
    console.log(`Mock data cleanup completed. Deleted rows: ${total}`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function run() {
  const shouldApply = process.argv.includes("--apply");
  const db = createDatabase(env);
  const client = await db.connect();

  try {
    if (shouldApply) {
      await applyCleanup(client);
    } else {
      await dryRun(client);
    }
  } finally {
    client.release();
    await closeDatabase(db);
  }
}

run().catch(async (error) => {
  console.error((await explainDatabaseConnectionError(error, env.DATABASE_URL)) ?? error);
  process.exit(1);
});
