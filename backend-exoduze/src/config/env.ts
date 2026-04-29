import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const booleanStringSchema = z.string().default("false").transform((value) => value === "true" || value === "1");
const enabledBooleanStringSchema = z.string().default("true").transform((value) => value === "true" || value === "1");
const optionalStringSchema = z.preprocess((value) => (value === "" ? undefined : value), z.string().min(1).optional());
const optionalUrlSchema = z.preprocess((value) => (value === "" ? undefined : value), z.string().url().optional());

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: z.enum(["disable", "require"]).default("require"),
  ADMIN_SOLANA_WALLET: z.string().min(1),
  SOLANA_RPC_URL: z.string().url().default("https://api.devnet.solana.com"),
  EXODUZE_PROGRAM_ID: z.string().min(1).default("C8ih3DKPzNi84Vg9BYx3iRcPWaZLS1iFJ9RVu5dzdswi"),
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
  AI_DECISION_PROVIDER: z.enum(["heuristic", "openai"]).default("heuristic"),
  AI_CANONICALIZATION_VERSION: z.string().min(1).default("exoduze-ai-v1"),
  OPENAI_API_KEY: optionalStringSchema,
  OPENAI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  OPENAI_MODEL: z.string().min(1).default("gpt-5.4-mini"),
  OPENAI_DECISION_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(900),
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
  COINGECKO_BASE_URL: z.string().url().default("https://api.coingecko.com/api/v3")
});

export const env = envSchema.parse(process.env);

export type Env = typeof env;
