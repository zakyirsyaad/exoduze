import type { PoolClient } from "pg";

import { env } from "../config/env.js";
import { explainDatabaseConnectionError } from "./connection-error.js";
import { closeDatabase, createDatabase } from "./database.js";

type CleanupStep = {
  label: string;
  countSql: string;
  deleteSql: string;
  params: unknown[];
};

const AUTO_PUBLISHED_ORACLE_SOURCE = "exoduze_hot_topic_rank";
const targetMarketsSql = `
  SELECT id
  FROM markets
  WHERE oracle_source = $1
`;
const targetMarketAgentsSql = `
  SELECT id
  FROM market_agents
  WHERE market_id IN (${targetMarketsSql})
`;

const steps: CleanupStep[] = [
  marketStep("auto-published payouts", "payouts"),
  marketStep("auto-published oracle results", "oracle_results"),
  marketStep("auto-published user positions", "user_positions"),
  marketStep("auto-published monitoring points", "market_monitoring_points"),
  marketStep("auto-published leaderboard facts", "leaderboard_facts"),
  marketStep("auto-published news-market links", "news_item_markets"),
  marketAgentStep("auto-published agent decisions", "agent_market_decisions"),
  marketAgentStep("auto-published agent commitments", "agent_commitments"),
  marketStep("auto-published market agents", "market_agents"),
  marketStep("auto-published market topics", "market_topics"),
  {
    label: "auto-published audit logs",
    countSql: `
      SELECT COUNT(*)::int AS count
      FROM audit_logs
      WHERE entity_type = 'market'
        AND entity_id IN (${targetMarketsSql})
    `,
    deleteSql: `
      DELETE FROM audit_logs
      WHERE entity_type = 'market'
        AND entity_id IN (${targetMarketsSql})
    `,
    params: [AUTO_PUBLISHED_ORACLE_SOURCE],
  },
  {
    label: "auto-published markets",
    countSql: `
      SELECT COUNT(*)::int AS count
      FROM markets
      WHERE oracle_source = $1
    `,
    deleteSql: `
      DELETE FROM markets
      WHERE oracle_source = $1
    `,
    params: [AUTO_PUBLISHED_ORACLE_SOURCE],
  },
];

function marketStep(label: string, table: string): CleanupStep {
  return {
    label,
    countSql: `
      SELECT COUNT(*)::int AS count
      FROM ${table}
      WHERE market_id IN (${targetMarketsSql})
    `,
    deleteSql: `
      DELETE FROM ${table}
      WHERE market_id IN (${targetMarketsSql})
    `,
    params: [AUTO_PUBLISHED_ORACLE_SOURCE],
  };
}

function marketAgentStep(label: string, table: string): CleanupStep {
  return {
    label,
    countSql: `
      SELECT COUNT(*)::int AS count
      FROM ${table}
      WHERE market_agent_id IN (${targetMarketAgentsSql})
    `,
    deleteSql: `
      DELETE FROM ${table}
      WHERE market_agent_id IN (${targetMarketAgentsSql})
    `,
    params: [AUTO_PUBLISHED_ORACLE_SOURCE],
  };
}

async function countRows(client: PoolClient, cleanupStep: CleanupStep) {
  const result = await client.query<{ count: number }>(
    cleanupStep.countSql,
    cleanupStep.params,
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function dryRun(client: PoolClient) {
  let total = 0;

  console.log(
    "Auto-published market cleanup dry run. Re-run with --apply to delete these rows.",
  );
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
      const result = await client.query(
        cleanupStep.deleteSql,
        cleanupStep.params,
      );
      const deleted = result.rowCount ?? 0;
      total += deleted;
      console.log(`${cleanupStep.label}: deleted ${deleted}`);
    }

    await client.query("COMMIT");
    console.log(`Auto-published market cleanup completed. Deleted rows: ${total}`);
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
  console.error(
    (await explainDatabaseConnectionError(error, env.DATABASE_URL)) ?? error,
  );
  process.exit(1);
});
