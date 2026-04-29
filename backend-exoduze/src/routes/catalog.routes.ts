import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { CatalogService } from "../modules/catalog/catalog.service.js";

const marketStatusSchema = z.enum(["draft", "upcoming", "open", "locked", "closed", "resolving", "disputed", "resolved", "cancelled"]);

const categoryPageQuerySchema = z.object({
  topic: z.string().optional(),
  status: marketStatusSchema.optional(),
  sort: z.enum(["ending_soon", "most_liquid", "newest"]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(50).default(20)
});

const categoryCreateBodySchema = z.object({
  slug: z.string().optional(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  sort_order: z.coerce.number().int().default(0),
  is_active: z.boolean().default(true)
});

const categoryPatchBodySchema = z
  .object({
    slug: z.string().optional(),
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    sort_order: z.coerce.number().int().optional(),
    is_active: z.boolean().optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one category field must be provided."
  });

const topicCreateBodySchema = z.object({
  category: z.string().min(1),
  slug: z.string().optional(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  is_active: z.boolean().default(true)
});

const topicPatchBodySchema = z
  .object({
    category: z.string().min(1).optional(),
    slug: z.string().optional(),
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    is_active: z.boolean().optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one topic field must be provided."
  });

export async function registerCatalogRoutes(app: FastifyInstance, service: CatalogService) {
  app.get("/v1/categories", async () => service.listCategories());

  app.post("/v1/categories", async (request, reply) => {
    const auth = app.requireAdmin(request, reply);
    if (!auth) {
      return;
    }

    const body = categoryCreateBodySchema.parse(request.body);
    reply.code(201);
    return service.createCategory({
      slug: body.slug ?? undefined,
      name: body.name,
      description: body.description,
      sortOrder: body.sort_order,
      isActive: body.is_active
    });
  });

  app.get("/v1/categories/:categorySlug", async (request, reply) => {
    const params = z.object({ categorySlug: z.string().min(1) }).parse(request.params);
    const query = categoryPageQuerySchema.parse(request.query);

    const result = await service.getCategoryPage(params.categorySlug, {
      topic: query.topic ?? undefined,
      status: query.status ?? undefined,
      sort: query.sort ?? undefined,
      cursor: query.cursor ?? undefined,
      limit: query.limit
    });

    if (!result) {
      return reply.code(404).send({
        error: "CATEGORY_NOT_FOUND",
        message: `Category '${params.categorySlug}' was not found.`
      });
    }

    return result;
  });

  app.put("/v1/categories/:categoryIdOrSlug", async (request, reply) => {
    const auth = app.requireAdmin(request, reply);
    if (!auth) {
      return;
    }

    const params = z.object({ categoryIdOrSlug: z.string().min(1) }).parse(request.params);
    const body = categoryCreateBodySchema.parse(request.body);

    return service.replaceCategory(params.categoryIdOrSlug, {
      slug: body.slug ?? undefined,
      name: body.name,
      description: body.description,
      sortOrder: body.sort_order,
      isActive: body.is_active
    });
  });

  app.patch("/v1/categories/:categoryIdOrSlug", async (request, reply) => {
    const auth = app.requireAdmin(request, reply);
    if (!auth) {
      return;
    }

    const params = z.object({ categoryIdOrSlug: z.string().min(1) }).parse(request.params);
    const body = categoryPatchBodySchema.parse(request.body);
    const payload = {
      ...(body.slug !== undefined ? { slug: body.slug } : {}),
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.sort_order !== undefined ? { sortOrder: body.sort_order } : {}),
      ...(body.is_active !== undefined ? { isActive: body.is_active } : {})
    };

    return service.patchCategory(params.categoryIdOrSlug, payload);
  });

  app.delete("/v1/categories/:categoryIdOrSlug", async (request, reply) => {
    const auth = app.requireAdmin(request, reply);
    if (!auth) {
      return;
    }

    const params = z.object({ categoryIdOrSlug: z.string().min(1) }).parse(request.params);
    return service.deleteCategory(params.categoryIdOrSlug);
  });

  app.post("/v1/topics", async (request, reply) => {
    const auth = app.requireAdmin(request, reply);
    if (!auth) {
      return;
    }

    const body = topicCreateBodySchema.parse(request.body);
    reply.code(201);
    return service.createTopic({
      category: body.category,
      slug: body.slug ?? undefined,
      name: body.name,
      description: body.description,
      isActive: body.is_active
    });
  });

  app.put("/v1/topics/:topicIdOrSlug", async (request, reply) => {
    const auth = app.requireAdmin(request, reply);
    if (!auth) {
      return;
    }

    const params = z.object({ topicIdOrSlug: z.string().min(1) }).parse(request.params);
    const body = topicCreateBodySchema.parse(request.body);

    return service.replaceTopic(params.topicIdOrSlug, {
      category: body.category,
      slug: body.slug ?? undefined,
      name: body.name,
      description: body.description,
      isActive: body.is_active
    });
  });

  app.patch("/v1/topics/:topicIdOrSlug", async (request, reply) => {
    const auth = app.requireAdmin(request, reply);
    if (!auth) {
      return;
    }

    const params = z.object({ topicIdOrSlug: z.string().min(1) }).parse(request.params);
    const body = topicPatchBodySchema.parse(request.body);
    const payload = {
      ...(body.category !== undefined ? { category: body.category } : {}),
      ...(body.slug !== undefined ? { slug: body.slug } : {}),
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.is_active !== undefined ? { isActive: body.is_active } : {})
    };

    return service.patchTopic(params.topicIdOrSlug, payload);
  });

  app.delete("/v1/topics/:topicIdOrSlug", async (request, reply) => {
    const auth = app.requireAdmin(request, reply);
    if (!auth) {
      return;
    }

    const params = z.object({ topicIdOrSlug: z.string().min(1) }).parse(request.params);
    return service.deleteTopic(params.topicIdOrSlug);
  });
}
