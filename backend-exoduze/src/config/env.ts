import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const booleanStringSchema = z.string().default("false").transform((value) => value === "true" || value === "1");
const enabledBooleanStringSchema = z.string().default("true").transform((value) => value === "true" || value === "1");
const optionalStringSchema = z.preprocess((value) => (value === "" ? undefined : value), z.string().min(1).optional());
const optionalUrlSchema = z.preprocess((value) => (value === "" ? undefined : value), z.string().url().optional());
const localCorsAllowedOrigins = "http://localhost:3000,http://127.0.0.1:3000,http://localhost:3003,http://127.0.0.1:3003";
const protectedRuntime = isProtectedRuntime(process.env);

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: z.enum(["disable", "require"]).default("require"),
  CORS_ALLOWED_ORIGINS: z.preprocess(
    (value) => process.env.CORS_ORIGINS ?? value,
    z.string().default(localCorsAllowedOrigins),
  ),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(120),
  CRON_ENABLED: booleanStringSchema,
  CRON_SECRET: optionalStringSchema,
  ADMIN_SOLANA_WALLET: z.string().min(1),
  SOLANA_RPC_URL: z.string().url().default("https://api.devnet.solana.com"),
  EXODUZE_PROGRAM_ID: z.string().min(1).default("HcK2u8Ko7L8ZXPRSUAC7ZiDYyT9LuRS383KChtzhkBkd"),
  EXODUZE_ADMIN_KEYPAIR_PATH: optionalStringSchema,
  EXODUZE_ORACLE_KEYPAIR_PATH: optionalStringSchema,
  EXODUZE_SETTLEMENT_MINT: optionalStringSchema,
  EXODUZE_TOKEN_PROGRAM_ID: z.string().min(1).default("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
  AUTH_CHALLENGE_TTL_MINUTES: z.coerce.number().int().positive().default(5),
  AUTH_SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24 * 7),
  NEWSAPI_API_KEY: optionalStringSchema,
  NEWSAPI_BASE_URL: z.string().url().default("https://newsapi.org/v2"),
  NEWSAPI_LANGUAGE: z.string().default("en"),
  NEWSAPI_COUNTRY: z.string().default("us"),
  FINNHUB_API_KEY: z.string().optional(),
  FINNHUB_BASE_URL: z.string().url().default("https://finnhub.io/api/v1"),
  FINNHUB_FINANCE_SYMBOLS: z.string().default("TSLA"),
  FINNHUB_COMPANY_NEWS_LOOKBACK_DAYS: z.coerce.number().int().positive().default(30),
  SUPABASE_URL: optionalUrlSchema,
  SUPABASE_SERVICE_ROLE_KEY: optionalStringSchema,
  SUPABASE_AGENT_AVATARS_BUCKET: z.string().min(1).default("agent-avatars"),
  AI_DECISION_PROVIDER: z.enum(["mock", "heuristic", "openai", "openrouter"]).default("heuristic"),
  AI_CANONICALIZATION_VERSION: z.string().min(1).default("exoduze-ai-v1"),
  OPENAI_API_KEY: optionalStringSchema,
  OPENAI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  OPENAI_MODEL: z.string().min(1).default("gpt-5.4-mini"),
  OPENAI_DECISION_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(900),
  OPENROUTER_API_KEY: optionalStringSchema,
  OPENROUTER_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
  OPENROUTER_MODEL: z.string().min(1).default("openrouter/owl-alpha"),
  OPENROUTER_DECISION_MAX_TOKENS: z.coerce.number().int().positive().default(900),
  OPENROUTER_SITE_URL: optionalUrlSchema,
  OPENROUTER_APP_NAME: z.string().min(1).default("Exoduze"),
  FEED_REFRESH_TTL_MINUTES: z.coerce.number().int().positive().default(20),
  MARKET_DEFAULT_JOIN_WINDOW_RATIO: z.coerce.number().positive().max(1).default(0.25),
  MARKET_DEFAULT_MIN_JOIN_WINDOW_HOURS: z.coerce.number().int().nonnegative().default(6),
  MARKET_DEFAULT_MAX_JOIN_WINDOW_HOURS: z.coerce.number().int().positive().default(24),
  MARKET_HIDE_LIVE_AGENT_DECISIONS_UNTIL_JOIN_DEADLINE: booleanStringSchema,
  AUTONOMOUS_MARKET_ENABLED: booleanStringSchema,
  AUTONOMOUS_MARKET_INTERVAL_SECONDS: z.coerce.number().int().positive().default(300),
  AUTONOMOUS_MARKET_CATEGORIES: z.string().default(""),
  AUTONOMOUS_SNAPSHOT_TOPIC_LIMIT: z.coerce.number().int().positive().max(50).default(10),
  AUTONOMOUS_MARKET_REQUIRED_RANK: z.coerce.number().int().positive().default(3),
  AUTONOMOUS_MARKET_MAX_MARKETS_PER_CATEGORY: z.coerce.number().int().positive().max(20).default(3),
  AUTONOMOUS_MARKET_MIN_TOPIC_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.35),
  AUTONOMOUS_AUTO_PUBLISH_ONCHAIN: booleanStringSchema,
  AUTONOMOUS_PUBLISH_BATCH_SIZE: z.coerce.number().int().positive().max(100).default(25),
  AUTONOMOUS_RESOLVE_ONCHAIN: booleanStringSchema,
  AUTONOMOUS_RESOLUTION_DISPUTE_WINDOW_MINUTES: z.coerce.number().int().nonnegative().default(0),
  MARKET_DISPUTE_WINDOW_MINUTES: z.coerce.number().int().positive().default(60),
  MARKET_GENERATION_ENABLED: enabledBooleanStringSchema,
  ORACLE_RESOLUTION_ENABLED: enabledBooleanStringSchema,
  PAYOUT_FEE_BPS: z.coerce.number().int().min(0).max(10_000).default(0),
  PAYOUT_TOP_AGENT_BONUS_BPS: z.coerce.number().int().min(0).max(10_000).default(0),
  COINGECKO_BASE_URL: z.string().url().default("https://api.coingecko.com/api/v3")
}).superRefine((value, ctx) => {
  if (!protectedRuntime) {
    return;
  }

  const corsOriginsConfigured =
    hasExplicitEnv("CORS_ORIGINS") || hasExplicitEnv("CORS_ALLOWED_ORIGINS");
  const corsOrigins = value.CORS_ALLOWED_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (!corsOriginsConfigured || corsOrigins.length === 0) {
    addEnvIssue(ctx, "CORS_ALLOWED_ORIGINS", "CORS_ORIGINS must be set to an explicit staging/production allowlist.");
  }

  if (
    corsOrigins.includes("*") ||
    corsOrigins.some((origin) => isLocalCorsOrigin(origin))
  ) {
    addEnvIssue(ctx, "CORS_ALLOWED_ORIGINS", "CORS_ORIGINS must not include wildcard or local development origins in staging/production.");
  }

  if (value.CRON_ENABLED && !value.CRON_SECRET) {
    addEnvIssue(ctx, "CRON_SECRET", "CRON_SECRET must be set when CRON_ENABLED=true in staging/production.");
  }

  if (value.AUTONOMOUS_RESOLUTION_DISPUTE_WINDOW_MINUTES <= 0) {
    addEnvIssue(ctx, "AUTONOMOUS_RESOLUTION_DISPUTE_WINDOW_MINUTES", "AUTONOMOUS_RESOLUTION_DISPUTE_WINDOW_MINUTES must be greater than 0 in staging/production.");
  }

  if (value.PAYOUT_TOP_AGENT_BONUS_BPS !== 0) {
    addEnvIssue(ctx, "PAYOUT_TOP_AGENT_BONUS_BPS", "PAYOUT_TOP_AGENT_BONUS_BPS must be 0 unless the deployed smart contract supports bonus payouts.");
  }

  if (!["openai", "openrouter"].includes(value.AI_DECISION_PROVIDER) || !hasExplicitEnv("AI_DECISION_PROVIDER")) {
    addEnvIssue(ctx, "AI_DECISION_PROVIDER", "AI_DECISION_PROVIDER must be explicitly set to openai or openrouter in staging/production.");
  }

  if (value.AI_DECISION_PROVIDER === "openai" && !value.OPENAI_API_KEY) {
    addEnvIssue(ctx, "OPENAI_API_KEY", "OPENAI_API_KEY must be set when AI_DECISION_PROVIDER=openai in staging/production.");
  }

  if (value.AI_DECISION_PROVIDER === "openrouter" && !value.OPENROUTER_API_KEY) {
    addEnvIssue(ctx, "OPENROUTER_API_KEY", "OPENROUTER_API_KEY must be set when AI_DECISION_PROVIDER=openrouter in staging/production.");
  }

  for (const key of [
    "SOLANA_RPC_URL",
    "EXODUZE_PROGRAM_ID",
    "EXODUZE_SETTLEMENT_MINT",
    "EXODUZE_TOKEN_PROGRAM_ID",
    "ADMIN_SOLANA_WALLET",
  ] as const) {
    if (!hasExplicitEnv(key)) {
      addEnvIssue(ctx, key, `${key} must be explicitly set in staging/production.`);
    }
  }

  for (const key of [
    "MARKET_GENERATION_ENABLED",
    "ORACLE_RESOLUTION_ENABLED",
  ] as const) {
    if (!hasExplicitEnv(key)) {
      addEnvIssue(ctx, key, `${key} must be explicitly set in staging/production.`);
    }
  }
});

export const env = envSchema.parse(process.env);

export type Env = typeof env;

function isProtectedRuntime(envValues: NodeJS.ProcessEnv) {
  return [
    envValues.APP_ENV,
    envValues.NODE_ENV,
    envValues.ENVIRONMENT,
    envValues.DEPLOY_ENV,
    envValues.VERCEL_ENV,
  ].some((value) => {
    const normalized = value?.trim().toLowerCase();
    return (
      normalized === "production" ||
      normalized === "prod" ||
      normalized === "staging" ||
      normalized === "stage"
    );
  });
}

function hasExplicitEnv(key: string) {
  return Boolean(process.env[key]?.trim());
}

function isLocalCorsOrigin(origin: string) {
  try {
    const url = new URL(origin);
    return ["localhost", "127.0.0.1", "0.0.0.0"].includes(url.hostname);
  } catch {
    return true;
  }
}

function addEnvIssue(
  ctx: z.RefinementCtx,
  key: string,
  message: string,
) {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: [key],
    message,
  });
}
