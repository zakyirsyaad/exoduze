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
    origin: true,
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
  const marketsService = new MarketsService(db, env, onchainService);
  const portfolioService = new PortfolioService(db, env, onchainService);
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
  await registerHealthRoutes(app);
  await registerAgentRoutes(app, agentsService);
  await registerCatalogRoutes(app, catalogService);
  await registerMarketRoutes(app, marketsService, aiMarketJoinService);
  await registerPortfolioRoutes(app, portfolioService);
  await registerFeedRoutes(app, feedService);
  await registerSystemRoutes(app, onchainService);
  await registerUploadRoutes(app, env);

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
