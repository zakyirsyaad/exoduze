import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { AgentsService } from "../modules/agents/agents.service.js";
import {
  agentSpecializations,
  dataFocusOptions,
  riskProfiles,
  visibilityOptions,
} from "../modules/ai/battle-config.js";

const listAgentsQuerySchema = z.object({
  owner_wallet: z.string().optional(),
  category: z.string().optional(),
  status: z.string().optional(),
  sort: z.enum(["top_rank", "newest", "name"]).default("top_rank"),
  limit: z.coerce.number().int().positive().max(100).default(50)
});

const hallOfFameQuerySchema = z.object({
  window: z.enum(["all_time"]).default("all_time"),
  limit: z.coerce.number().int().positive().max(100).default(20)
});

const ownerAgentsQuerySchema = z.object({
  category: z.string().optional(),
  status: z.string().optional(),
  sort: z.enum(["top_rank", "newest", "name"]).default("top_rank"),
  limit: z.coerce.number().int().positive().max(100).default(50)
});

const specializationSchema = z.enum(agentSpecializations);
const riskProfileSchema = z.enum(riskProfiles);
const dataFocusSchema = z.enum(dataFocusOptions);
const visibilitySchema = z.enum(visibilityOptions);

const agentCreateBodySchema = z.object({
  owner_wallet: z.string().optional(),
  slug: z.string().optional(),
  name: z.string().min(1),
  description: z.string().default(""),
  status: z.enum(["active", "inactive"]).default("active"),
  avatar_uri: z.string().url().nullable().optional(),
  category_slugs: z.array(z.string().min(1)).min(1).optional(),
  specialization: specializationSchema.optional(),
  base_personality: z.string().min(1).optional(),
  base_strategy: z.string().min(1).optional(),
  risk_profile: riskProfileSchema.optional(),
  data_focus: z.array(dataFocusSchema).max(dataFocusOptions.length).optional(),
  visibility: visibilitySchema.default("public")
});

const agentPatchBodySchema = z
  .object({
    owner_wallet: z.string().optional(),
    slug: z.string().optional(),
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    status: z.enum(["active", "inactive"]).optional(),
    avatar_uri: z.string().url().nullable().optional(),
    category_slugs: z.array(z.string().min(1)).min(1).optional(),
    specialization: specializationSchema.optional(),
    base_personality: z.string().min(1).optional(),
    base_strategy: z.string().min(1).optional(),
    risk_profile: riskProfileSchema.optional(),
    data_focus: z.array(dataFocusSchema).max(dataFocusOptions.length).optional(),
    visibility: visibilitySchema.optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one agent field must be provided."
  });

export async function registerAgentRoutes(app: FastifyInstance, service: AgentsService) {
  app.get("/v1/agents", async (request) => {
    const query = listAgentsQuerySchema.parse(request.query);
    return service.listAgents({
      ownerWallet: query.owner_wallet ?? undefined,
      category: query.category ?? undefined,
      status: query.status ?? undefined,
      sort: query.sort,
      limit: query.limit
    });
  });

  app.post("/v1/agents", async (request, reply) => {
    const auth = app.requireAuth(request, reply);
    if (!auth) {
      return;
    }

    const body = agentCreateBodySchema.parse(request.body);
    reply.code(201);
    return service.createAgent(auth, {
      ownerWallet: body.owner_wallet ?? undefined,
      slug: body.slug ?? undefined,
      name: body.name,
      description: body.description,
      status: body.status,
      avatarUri: body.avatar_uri,
      categorySlugs: body.category_slugs,
      specialization: body.specialization,
      basePersonality: body.base_personality,
      baseStrategy: body.base_strategy,
      riskProfile: body.risk_profile,
      dataFocus: body.data_focus,
      visibility: body.visibility
    });
  });

  app.get("/v1/agents/hall-of-fame", async (request) => {
    const query = hallOfFameQuerySchema.parse(request.query);
    return service.getHallOfFame({
      window: query.window,
      limit: query.limit
    });
  });

  app.put("/v1/agents/:agentIdOrSlug", async (request, reply) => {
    const auth = app.requireAuth(request, reply);
    if (!auth) {
      return;
    }

    const params = z.object({ agentIdOrSlug: z.string().min(1) }).parse(request.params);
    const body = agentCreateBodySchema.parse(request.body);

    return service.replaceAgent(auth, params.agentIdOrSlug, {
      ownerWallet: body.owner_wallet ?? undefined,
      slug: body.slug ?? undefined,
      name: body.name,
      description: body.description,
      status: body.status,
      avatarUri: body.avatar_uri,
      categorySlugs: body.category_slugs,
      specialization: body.specialization,
      basePersonality: body.base_personality,
      baseStrategy: body.base_strategy,
      riskProfile: body.risk_profile,
      dataFocus: body.data_focus,
      visibility: body.visibility
    });
  });

  app.patch("/v1/agents/:agentIdOrSlug", async (request, reply) => {
    const auth = app.requireAuth(request, reply);
    if (!auth) {
      return;
    }

    const params = z.object({ agentIdOrSlug: z.string().min(1) }).parse(request.params);
    const body = agentPatchBodySchema.parse(request.body);
    const payload = {
      ...(body.owner_wallet !== undefined ? { ownerWallet: body.owner_wallet } : {}),
      ...(body.slug !== undefined ? { slug: body.slug } : {}),
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.avatar_uri !== undefined ? { avatarUri: body.avatar_uri } : {}),
      ...(body.category_slugs !== undefined ? { categorySlugs: body.category_slugs } : {}),
      ...(body.specialization !== undefined ? { specialization: body.specialization } : {}),
      ...(body.base_personality !== undefined ? { basePersonality: body.base_personality } : {}),
      ...(body.base_strategy !== undefined ? { baseStrategy: body.base_strategy } : {}),
      ...(body.risk_profile !== undefined ? { riskProfile: body.risk_profile } : {}),
      ...(body.data_focus !== undefined ? { dataFocus: body.data_focus } : {}),
      ...(body.visibility !== undefined ? { visibility: body.visibility } : {})
    };

    return service.patchAgent(auth, params.agentIdOrSlug, payload);
  });

  app.delete("/v1/agents/:agentIdOrSlug", async (request, reply) => {
    const auth = app.requireAuth(request, reply);
    if (!auth) {
      return;
    }

    const params = z.object({ agentIdOrSlug: z.string().min(1) }).parse(request.params);
    return service.deleteAgent(auth, params.agentIdOrSlug);
  });

  app.get("/v1/owners", async () => service.listOwners());

  app.get("/v1/owners/:walletAddress", async (request, reply) => {
    const params = z.object({ walletAddress: z.string().min(1) }).parse(request.params);
    const result = await service.getOwnerProfile(params.walletAddress);

    if (!result) {
      return reply.code(404).send({
        error: "OWNER_NOT_FOUND",
        message: `Owner '${params.walletAddress}' was not found.`
      });
    }

    return result;
  });

  app.get("/v1/owners/:walletAddress/agents", async (request, reply) => {
    const params = z.object({ walletAddress: z.string().min(1) }).parse(request.params);
    const query = ownerAgentsQuerySchema.parse(request.query);

    const result = await service.listOwnerAgents(params.walletAddress, {
      category: query.category ?? undefined,
      status: query.status ?? undefined,
      sort: query.sort,
      limit: query.limit
    });

    if (!result) {
      return reply.code(404).send({
        error: "OWNER_NOT_FOUND",
        message: `Owner '${params.walletAddress}' was not found.`
      });
    }

    return result;
  });
}
