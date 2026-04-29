import { Pool } from "pg";

import type { Env } from "../config/env.js";

export type AppDatabase = Pool;

export function createDatabase(env: Env): AppDatabase {
  return new Pool({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_SSL === "require" ? { rejectUnauthorized: false } : undefined,
    max: 10,
    idleTimeoutMillis: 30_000
  });
}

export async function closeDatabase(db: AppDatabase): Promise<void> {
  await db.end();
}
