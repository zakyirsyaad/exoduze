import { closeDatabase, createDatabase } from "../src/db/database.js";
import { env } from "../src/config/env.js";

const db = createDatabase(env);
const category = process.argv[2]?.trim().toLowerCase() || null;
const limit = Number(process.argv[3] ?? 10);

try {
  const params: unknown[] = [];
  const where: string[] = [];

  if (category) {
    where.push(`c.slug = $${params.length + 1}`);
    params.push(category);
  }
  params.push(Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : 10);

  const result = await db.query(
    `
      SELECT
        m.id,
        m.slug,
        m.title,
        m.onchain_market_pubkey,
        c.slug AS category_slug,
        m.created_at::text,
        m.generated_reason
      FROM markets m
      JOIN categories c ON c.id = m.category_id
      ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY m.created_at DESC
      LIMIT $${params.length}
    `,
    params,
  );

  console.log(JSON.stringify(result.rows, null, 2));
} finally {
  await closeDatabase(db);
}
