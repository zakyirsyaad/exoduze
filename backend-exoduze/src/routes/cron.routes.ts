import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { Env } from "../config/env.js";
import type { AppDatabase } from "../db/database.js";
import { HttpError } from "../lib/http-error.js";
import { writeAuditLog } from "../modules/audit/audit-log.js";
import { AiMarketJoinService } from "../modules/ai/ai-market-join.service.js";
import { MarketGeneratorService } from "../modules/markets/market-generator.js";
import { OracleResolverService } from "../modules/markets/oracle-resolver.js";
import { ResolutionFinalizerService } from "../modules/markets/resolution-finalizer.js";
import { TopicSnapshotsService } from "../modules/topics/topic-snapshots.js";

const cronJobIdSchema = z.enum([
  "generate-topic-snapshot",
  "generate-markets",
  "refresh-ai-decisions",
  "resolve-markets",
  "finalize-resolutions",
]);

const generateTopicSnapshotBodySchema = z.object({
  category: z.string().trim().min(1).default("finance"),
  dev: z.boolean().optional(),
  limit: z.coerce.number().int().positive().max(50).default(10),
});

const generateMarketsBodySchema = z.object({
  category: z.string().trim().min(1).default("finance"),
  required_rank: z.coerce.number().int().positive().default(3),
  max_markets: z.coerce.number().int().positive().max(20).default(3),
  dev_sample: z.boolean().optional(),
});

export async function registerCronRoutes(
  app: FastifyInstance,
  env: Env,
  db: AppDatabase,
  topicSnapshotsService: TopicSnapshotsService,
  marketGeneratorService: MarketGeneratorService,
  aiMarketJoinService: AiMarketJoinService,
  oracleResolverService: OracleResolverService,
  resolutionFinalizerService: ResolutionFinalizerService,
) {
  app.post("/api/cron/:jobId", async (request, reply) => {
    const rawJobId = getRawCronJobId(request.params);
    await writeAuditLog(db, app.log, {
      action: "cron.run_attempted",
      actorType: "system",
      entityType: "cron_job",
      entityId: rawJobId,
    });

    try {
      assertCronAuthorized(request.headers.authorization, env);
    } catch (error) {
      await writeAuditLog(db, app.log, {
        action: "cron.run_blocked",
        actorType: "system",
        entityType: "cron_job",
        entityId: rawJobId,
        after: {
          reason: error instanceof HttpError ? error.code : "CRON_BLOCKED",
        },
      });
      throw error;
    }

    const params = z.object({ jobId: cronJobIdSchema }).parse(request.params);

    if (params.jobId === "generate-topic-snapshot") {
      const body = generateTopicSnapshotBodySchema.parse(request.body ?? {});
      const snapshot =
        body.dev && body.category === "finance"
          ? await topicSnapshotsService.saveDevFinanceSnapshot()
          : await topicSnapshotsService.saveLatestHotTopicSnapshot(
              body.category,
              body.limit,
            );

      return buildCronResult({
        snapshotsCreated: snapshot ? 1 : 0,
        snapshot,
      });
    }

    if (params.jobId === "generate-markets") {
      const body = generateMarketsBodySchema.parse(request.body ?? {});
      const snapshot = body.dev_sample
        ? await topicSnapshotsService.saveDevFinanceSnapshot()
        : (await topicSnapshotsService.getLatestSnapshotByCategory(body.category)) ??
          (await topicSnapshotsService.saveLatestHotTopicSnapshot(
            body.category,
            body.max_markets,
          ));

      if (!snapshot) {
        throw new HttpError(
          404,
          "TOPIC_SNAPSHOT_NOT_FOUND",
          `No topic snapshot was available for category '${body.category}'.`,
        );
      }

      const markets = await marketGeneratorService.createMarketsFromSnapshot({
        snapshot,
        requiredRank: body.required_rank,
        maxMarkets: body.max_markets,
        minConfidence: env.AUTONOMOUS_MARKET_MIN_TOPIC_CONFIDENCE,
        skipIfActiveMarketExists: true,
      });

      return buildCronResult({
        marketsCreated: markets.marketsCreated,
        skipped: markets.skipped,
        markets,
        snapshot,
      });
    }

    if (params.jobId === "resolve-markets") {
      const result = await oracleResolverService.resolveMarkets();
      return buildCronResult({
        marketsChecked: result.marketsChecked,
        resolutionsProposed: result.resolutionsProposed,
        skipped: result.skipped,
        errors: result.errors,
      });
    }

    if (params.jobId === "refresh-ai-decisions") {
      const result = await aiMarketJoinService.refreshLiveMarketDecisions();
      return buildCronResult({
        decisionsRefreshed: result.decisionsRefreshed,
        skipped: result.skipped,
        errors: result.errors,
      });
    }

    const result = await resolutionFinalizerService.finalizeResolutions();
    return buildCronResult({
      resolutionsFinalized: result.resolutionsFinalized,
      skipped: result.skipped,
      errors: result.errors,
    });
  });
}

function getRawCronJobId(params: unknown) {
  if (
    typeof params === "object" &&
    params !== null &&
    "jobId" in params &&
    typeof params.jobId === "string" &&
    params.jobId.trim()
  ) {
    return params.jobId.trim();
  }

  return "unknown";
}

function assertCronAuthorized(authorization: string | undefined, env: Env) {
  if (!env.CRON_ENABLED) {
    throw new HttpError(
      503,
      "CRON_DISABLED",
      "Cron endpoints are disabled. Set CRON_ENABLED=true and CRON_SECRET before enabling scheduled jobs.",
    );
  }

  if (!env.CRON_SECRET) {
    throw new HttpError(
      503,
      "CRON_NOT_CONFIGURED",
      "CRON_SECRET must be configured before cron endpoints can run.",
    );
  }

  if (authorization !== `Bearer ${env.CRON_SECRET}`) {
    throw new HttpError(
      401,
      "CRON_AUTH_REQUIRED",
      "A valid cron bearer token is required.",
    );
  }
}

function buildCronResult(input: {
  snapshotsCreated?: number;
  marketsCreated?: number;
  marketsChecked?: number;
  decisionsRefreshed?: number;
  resolutionsProposed?: number;
  resolutionsFinalized?: number;
  skipped?: number;
  errors?: Array<Record<string, unknown>>;
  snapshot?: unknown;
  markets?: unknown;
}) {
  const counts = {
    snapshotsCreated: input.snapshotsCreated ?? 0,
    marketsCreated: input.marketsCreated ?? 0,
    marketsChecked: input.marketsChecked ?? 0,
    decisionsRefreshed: input.decisionsRefreshed ?? 0,
    resolutionsProposed: input.resolutionsProposed ?? 0,
    resolutionsFinalized: input.resolutionsFinalized ?? 0,
  };

  return {
    success: (input.errors ?? []).length === 0,
    counts,
    ...counts,
    skipped: input.skipped ?? 0,
    errors: input.errors ?? [],
    ...(input.snapshot !== undefined ? { snapshot: input.snapshot } : {}),
    ...(input.markets !== undefined ? { markets: input.markets } : {}),
  };
}
