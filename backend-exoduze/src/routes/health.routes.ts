import type { FastifyInstance } from "fastify";
import type { QueryResultRow } from "pg";

import type { Env } from "../config/env.js";
import type { AppDatabase } from "../db/database.js";
import type { ExoduzeOnchainService } from "../modules/onchain/exoduze-onchain.service.js";

type ReadinessStatus = "ok" | "degraded";

type ReadinessCheck = {
  status: "ok" | "unavailable" | "misconfigured";
  message?: string;
};

export async function registerHealthRoutes(
  app: FastifyInstance,
  env: Env,
  db: AppDatabase,
  onchainService: ExoduzeOnchainService,
) {
  app.get("/health", async () => ({
    ok: true,
    service: "exoduze-backend",
    timestamp: new Date().toISOString()
  }));

  app.get("/ready", async (_request, reply) => {
    const checks = {
      env: checkEnvValidation(),
      database: await checkDatabase(db),
      solana_rpc: await checkSolanaRpc(onchainService),
      ai_provider: checkAiProvider(env),
    };
    const status: ReadinessStatus = Object.values(checks).every(
      (check) => check.status === "ok",
    )
      ? "ok"
      : "degraded";

    if (status !== "ok") {
      reply.code(503);
    }

    return {
      ok: status === "ok",
      service: "exoduze-backend",
      status,
      checks,
      timestamp: new Date().toISOString(),
    };
  });
}

function checkEnvValidation(): ReadinessCheck {
  return {
    status: "ok",
    message: "required env validation passed at startup",
  };
}

async function checkDatabase(db: AppDatabase): Promise<ReadinessCheck> {
  try {
    await db.query<QueryResultRow>("SELECT 1");
    return { status: "ok" };
  } catch {
    return {
      status: "unavailable",
      message: "database connectivity check failed",
    };
  }
}

async function checkSolanaRpc(
  onchainService: ExoduzeOnchainService,
): Promise<ReadinessCheck> {
  try {
    await onchainService.checkRpcAvailability();
    return { status: "ok" };
  } catch {
    return {
      status: "unavailable",
      message: "solana rpc availability check failed",
    };
  }
}

function checkAiProvider(env: Env): ReadinessCheck {
  if (env.AI_DECISION_PROVIDER !== "openai") {
    return {
      status: "ok",
      message: `provider=${env.AI_DECISION_PROVIDER}`,
    };
  }

  if (!env.OPENAI_API_KEY) {
    return {
      status: "misconfigured",
      message: "openai provider selected without an api key",
    };
  }

  return {
    status: "ok",
    message: "provider=openai",
  };
}
