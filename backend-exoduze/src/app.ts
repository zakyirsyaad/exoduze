import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import { ZodError } from "zod";

import { env } from "./config/env.js";
import { closeDatabase, createDatabase } from "./db/database.js";
import { HttpError } from "./lib/http-error.js";
import { AgentsService } from "./modules/agents/agents.service.js";
import { registerAuthSupport } from "./modules/auth/auth.plugin.js";
import { AuthError, AuthService } from "./modules/auth/auth.service.js";
import { AiMarketJoinService } from "./modules/ai/ai-market-join.service.js";
import { CatalogService } from "./modules/catalog/catalog.service.js";
import { FeedService } from "./modules/feed/feed.service.js";
import { AutonomousMarketRunner } from "./modules/markets/autonomous-market-runner.js";
import { MarketGeneratorService } from "./modules/markets/market-generator.js";
import { MarketsService } from "./modules/markets/markets.service.js";
import { OracleResolverService } from "./modules/markets/oracle-resolver.js";
import { ResolutionFinalizerService } from "./modules/markets/resolution-finalizer.js";
import { ExoduzeOnchainService } from "./modules/onchain/exoduze-onchain.service.js";
import { PortfolioService } from "./modules/portfolio/portfolio.service.js";
import { TopicSnapshotsService } from "./modules/topics/topic-snapshots.js";
import { registerAgentRoutes } from "./routes/agent.routes.js";
import { registerAuthRoutes } from "./routes/auth.routes.js";
import { registerCatalogRoutes } from "./routes/catalog.routes.js";
import { registerCronRoutes } from "./routes/cron.routes.js";
import { registerFeedRoutes } from "./routes/feed.routes.js";
import { registerHealthRoutes } from "./routes/health.routes.js";
import { registerMarketRoutes } from "./routes/market.routes.js";
import { registerPortfolioRoutes } from "./routes/portfolio.routes.js";
import { registerSystemRoutes } from "./routes/system.routes.js";
import { registerUploadRoutes } from "./routes/upload.routes.js";

export async function buildApp() {
  const app = Fastify({
    logger: true,
    routerOptions: {
      // Generated market slugs can legitimately exceed Fastify's
      // default route param limit, so raise it to keep detail/news
      // routes reachable for existing long-form market URLs.
      maxParamLength: 512,
    },
  });

  await app.register(cors, {
    origin: buildCorsAllowedOrigins(env.CORS_ALLOWED_ORIGINS),
  });

  app.addHook("onRequest", async (_request, reply) => {
    setSecurityHeaders(reply);
  });

  app.addHook("onRequest", async (request, reply) => {
    if (isHealthProbe(request.url)) {
      return;
    }

    const rateLimit = checkRateLimit(
      `${request.ip}:${request.method}:${request.url.split("?")[0]}`,
      env.RATE_LIMIT_WINDOW_SECONDS,
      env.RATE_LIMIT_MAX_REQUESTS,
    );

    reply.header("x-ratelimit-limit", env.RATE_LIMIT_MAX_REQUESTS.toString());
    reply.header("x-ratelimit-remaining", rateLimit.remaining.toString());
    reply.header("x-ratelimit-reset", rateLimit.resetAt.toString());

    if (!rateLimit.allowed) {
      return reply.code(429).send({
        error: "RATE_LIMITED",
        message: "Too many requests. Please try again later.",
      });
    }
  });

  await app.register(multipart, {
    limits: {
      files: 1,
      fileSize: 2 * 1024 * 1024,
    },
  });

  await app.register(websocket);

  const db = createDatabase(env);
  await db.query("SELECT 1");
  const authService = new AuthService(db, env);
  const agentsService = new AgentsService(db);
  const catalogService = new CatalogService(db);
  const onchainService = new ExoduzeOnchainService(env);
  const aiMarketJoinService = new AiMarketJoinService(db, env, onchainService);
  const marketsService = new MarketsService(db, env, onchainService, app.log);
  const portfolioService = new PortfolioService(
    db,
    env,
    onchainService,
    app.log,
  );
  const feedService = new FeedService(db, env, app.log);
  const topicSnapshotsService = new TopicSnapshotsService(db);
  const marketGeneratorService = new MarketGeneratorService(db, env);
  const oracleResolverService = new OracleResolverService(db, env, app.log);
  const resolutionFinalizerService = new ResolutionFinalizerService(
    db,
    env,
    marketsService,
    onchainService,
    app.log,
  );
  const autonomousMarketRunner = new AutonomousMarketRunner(
    db,
    env,
    topicSnapshotsService,
    marketGeneratorService,
    marketsService,
    oracleResolverService,
    resolutionFinalizerService,
    app.log,
  );

  app.addHook("onClose", async () => {
    autonomousMarketRunner.stop();
    await closeDatabase(db);
  });

  await registerAuthSupport(app, authService);
  await registerAuthRoutes(app, authService);
  await registerHealthRoutes(app, env, db, onchainService);
  await registerAgentRoutes(app, agentsService);
  await registerCatalogRoutes(app, catalogService);
  await registerMarketRoutes(app, marketsService, aiMarketJoinService);
  await registerPortfolioRoutes(app, portfolioService);
  await registerFeedRoutes(app, feedService);
  await registerSystemRoutes(app, onchainService);
  await registerUploadRoutes(app, env);
  await registerCronRoutes(
    app,
    env,
    db,
    topicSnapshotsService,
    marketGeneratorService,
    oracleResolverService,
    resolutionFinalizerService,
  );

  autonomousMarketRunner.start();

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({
        error: error.code,
        message: error.message,
      });
    }

    if (error instanceof AuthError) {
      return reply.code(error.statusCode).send({
        error: error.code,
        message: error.message,
      });
    }

    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: "VALIDATION_ERROR",
        message: "Request validation failed.",
        details: error.flatten(),
      });
    }

    app.log.error(error);
    return reply.code(500).send({
      error: "INTERNAL_SERVER_ERROR",
      message: "Something went wrong while processing the request.",
    });
  });

  return app;
}

const rateLimitBuckets = new Map<
  string,
  {
    count: number;
    resetAt: number;
  }
>();

function buildCorsAllowedOrigins(allowedOriginsValue: string) {
  const allowedOrigins = [
    ...new Set(
    allowedOriginsValue
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    ),
  ];

  if (allowedOrigins.includes("*")) {
    return true;
  }

  return allowedOrigins;
}

function setSecurityHeaders(reply: {
  header: (name: string, value: string) => unknown;
}) {
  reply.header("x-content-type-options", "nosniff");
  reply.header("x-frame-options", "DENY");
  reply.header("referrer-policy", "no-referrer");
  reply.header(
    "permissions-policy",
    "camera=(), microphone=(), geolocation=(), payment=()",
  );
}

function checkRateLimit(
  key: string,
  windowSeconds: number,
  maxRequests: number,
) {
  const now = Date.now();
  const current = rateLimitBuckets.get(key);

  if (!current || current.resetAt <= now) {
    const resetAt = now + windowSeconds * 1000;
    rateLimitBuckets.set(key, { count: 1, resetAt });
    cleanupExpiredRateLimitBuckets(now);
    return {
      allowed: true,
      remaining: Math.max(0, maxRequests - 1),
      resetAt,
    };
  }

  current.count += 1;
  return {
    allowed: current.count <= maxRequests,
    remaining: Math.max(0, maxRequests - current.count),
    resetAt: current.resetAt,
  };
}

function cleanupExpiredRateLimitBuckets(now: number) {
  if (rateLimitBuckets.size < 10_000) {
    return;
  }

  for (const [key, bucket] of rateLimitBuckets.entries()) {
    if (bucket.resetAt <= now) {
      rateLimitBuckets.delete(key);
    }
  }
}

function isHealthProbe(url: string) {
  const pathname = url.split("?")[0];
  return pathname === "/health" || pathname === "/ready";
}
