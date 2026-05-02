import { Pool } from "pg";

import type { Env } from "../config/env.js";

export type AppDatabase = Pool;

type DatabaseLogger = {
  error?: (input: unknown, message?: string) => void;
};

export function createDatabase(env: Env, logger?: DatabaseLogger): AppDatabase {
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_SSL === "require" ? { rejectUnauthorized: false } : undefined,
    max: 10,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  });

  pool.on("error", (error) => {
    const message = "Postgres pool idle client error.";

    if (logger?.error) {
      logger.error({ err: error }, message);
      return;
    }

    console.error(message, error);
  });

  return pool;
}

export async function closeDatabase(db: AppDatabase): Promise<void> {
  await db.end();
}
