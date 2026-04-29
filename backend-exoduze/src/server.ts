import { env } from "./config/env.js";
import { buildApp } from "./app.js";
import { explainDatabaseConnectionError } from "./db/connection-error.js";

try {
  const app = await buildApp();

  await app.listen({
    host: env.HOST,
    port: env.PORT,
  });
} catch (error) {
  console.error((await explainDatabaseConnectionError(error, env.DATABASE_URL)) ?? error);
  process.exit(1);
}
