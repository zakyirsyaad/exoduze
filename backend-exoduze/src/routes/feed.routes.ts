import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { FeedService } from "../modules/feed/feed.service.js";

const liveFeedQuerySchema = z.object({
  category: z.string().optional(),
  topic: z.string().optional(),
  limit: z.coerce.number().int().positive().max(50).default(20)
});

const hotTopicsQuerySchema = z.object({
  category: z.string().optional(),
  window: z.enum(["24h"]).default("24h"),
  limit: z.coerce.number().int().positive().max(50).default(10)
});

const refreshFeedBodySchema = z.object({
  category: z.string().optional(),
  force: z.boolean().default(true)
});

export async function registerFeedRoutes(app: FastifyInstance, service: FeedService) {
  app.get("/v1/feed/live", async (request) => {
    const query = liveFeedQuerySchema.parse(request.query);
    return service.getLiveFeed({
      category: query.category ?? undefined,
      topic: query.topic ?? undefined,
      limit: query.limit
    });
  });

  app.get("/v1/feed/hot-topics", async (request) => {
    const query = hotTopicsQuerySchema.parse(request.query);
    return service.getHotTopics({
      category: query.category ?? undefined,
      window: query.window,
      limit: query.limit
    });
  });

  app.post("/v1/feed/refresh", async (request, reply) => {
    const auth = app.requireAdmin(request, reply);
    if (!auth) {
      return;
    }

    const body = refreshFeedBodySchema.parse(request.body ?? {});
    return service.refreshFeed({
      category: body.category ?? undefined,
      force: body.force
    });
  });
}
