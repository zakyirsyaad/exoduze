import type { Pool, PoolClient, QueryResultRow } from "pg";

type Queryable = Pool | PoolClient;

export async function queryRows<T extends QueryResultRow>(
  db: Queryable,
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const result = await db.query(text, params);
  return result.rows as T[];
}

export async function queryOne<T extends QueryResultRow>(
  db: Queryable,
  text: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await queryRows<T>(db, text, params);
  return rows[0] ?? null;
}
