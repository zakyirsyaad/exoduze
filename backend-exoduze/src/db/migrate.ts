import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { env } from "../config/env.js";
import { explainDatabaseConnectionError } from "./connection-error.js";
import { createDatabase, closeDatabase } from "./database.js";

async function run() {
  const db = createDatabase(env);
  const migrationsDir = path.resolve(process.cwd(), "supabase", "migrations");
  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    throw new Error(`No SQL migrations found in ${migrationsDir}`);
  }

  try {
    for (const file of files) {
      const sql = readFileSync(path.join(migrationsDir, file), "utf8");
      await db.query(sql);
      console.log(`Applied migration: ${file}`);
    }
  } finally {
    await closeDatabase(db);
  }
}

run().catch(async (error) => {
  console.error((await explainDatabaseConnectionError(error, env.DATABASE_URL)) ?? error);
  process.exit(1);
});
