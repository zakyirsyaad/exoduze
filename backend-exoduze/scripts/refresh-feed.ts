import { closeDatabase, createDatabase } from "../src/db/database.js";
import { env } from "../src/config/env.js";
import { queryRows } from "../src/db/query.js";
import { FeedService } from "../src/modules/feed/feed.service.js";

const db = createDatabase(env);
const categories = process.argv
  .slice(2)
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

const logger = {
  error(input: unknown, message?: string) {
    console.error(JSON.stringify({ level: "error", message, data: input }));
  },
};

const service = new FeedService(db, env, logger);

try {
  const targets =
    categories.length > 0
      ? categories
      : (
          await queryRows<{ slug: string }>(
            db,
            "SELECT slug FROM categories WHERE is_active = true ORDER BY slug ASC",
          )
        ).map((row) => row.slug);

  for (const category of targets) {
    await service.refreshFeed({ category, force: true });
  }

  console.log(
    JSON.stringify(
      {
        refreshed_categories: targets,
        refreshed_at: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
} finally {
  await closeDatabase(db);
}
