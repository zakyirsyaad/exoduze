import assert from "node:assert/strict";
import test from "node:test";

import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { ZodError } from "zod";

import { HttpError } from "../lib/http-error.js";
import type { RequestAuth } from "../modules/auth/auth.types.js";
import type { AiMarketJoinService } from "../modules/ai/ai-market-join.service.js";
import type { MarketsService } from "../modules/markets/markets.service.js";
import { registerMarketRoutes } from "./market.routes.js";

test("public dispute submission succeeds for an authenticated wallet user", async () => {
  const { app, service } = await buildTestApp();

  const response = await app.inject({
    method: "POST",
    url: "/v1/markets/test-market/resolutions/resolution-1/dispute",
    headers: { authorization: "Bearer user" },
    payload: { reason: "The oracle evidence does not match the rule." },
  });

  assert.equal(response.statusCode, 201);
  assert.equal(service.createdDisputes.length, 1);
  assert.deepEqual(service.createdDisputes[0], {
    marketIdOrSlug: "test-market",
    resolutionId: "resolution-1",
    walletIdentityId: "wallet-user",
  });

  await app.close();
});

test("public dispute submission rejects unauthenticated requests", async () => {
  const { app } = await buildTestApp();

  const response = await app.inject({
    method: "POST",
    url: "/v1/markets/test-market/resolutions/resolution-1/dispute",
    payload: { reason: "The oracle evidence does not match the rule." },
  });

  assert.equal(response.statusCode, 401);

  await app.close();
});

test("admin dispute list requires admin auth", async () => {
  const { app } = await buildTestApp();

  const response = await app.inject({
    method: "GET",
    url: "/v1/admin/disputes",
    headers: { authorization: "Bearer user" },
  });

  assert.equal(response.statusCode, 403);

  await app.close();
});

test("admin dispute accept and reject require admin auth", async () => {
  const { app } = await buildTestApp();

  const acceptResponse = await app.inject({
    method: "POST",
    url: "/v1/admin/disputes/dispute-1/accept",
    headers: { authorization: "Bearer user" },
    payload: { final_outcome: "YES" },
  });
  const rejectResponse = await app.inject({
    method: "POST",
    url: "/v1/admin/disputes/dispute-1/reject",
    headers: { authorization: "Bearer user" },
  });

  assert.equal(acceptResponse.statusCode, 403);
  assert.equal(rejectResponse.statusCode, 403);

  await app.close();
});

test("admin dispute review routes return not found for missing disputes", async () => {
  const { app } = await buildTestApp();

  const response = await app.inject({
    method: "POST",
    url: "/v1/admin/disputes/missing/accept",
    headers: { authorization: "Bearer admin" },
    payload: { final_outcome: "YES" },
  });

  assert.equal(response.statusCode, 404);

  await app.close();
});

async function buildTestApp() {
  const app = Fastify({ logger: false });
  const service = new FakeMarketDisputeService();
  await app.register(websocket);

  app.decorateRequest("auth", null);
  app.addHook("onRequest", async (request) => {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
    request.auth =
      token === "admin" ? ADMIN_AUTH : token === "user" ? USER_AUTH : null;
  });
  app.decorate("requireAuth", (request, reply) => {
    if (!request.auth) {
      reply.code(401).send({ error: "AUTH_REQUIRED" });
      return null;
    }

    return request.auth;
  });
  app.decorate("requireAdmin", (request, reply) => {
    const auth = app.requireAuth(request, reply);
    if (!auth) {
      return null;
    }

    if (!auth.isAdmin) {
      reply.code(403).send({ error: "ADMIN_REQUIRED" });
      return null;
    }

    return auth;
  });
  app.decorate("requireWalletAccess", (request, reply, _walletAddress) =>
    app.requireAuth(request, reply),
  );
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({
        error: error.code,
        message: error.message,
      });
    }

    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "VALIDATION_ERROR" });
    }

    throw error;
  });

  await registerMarketRoutes(
    app,
    service as unknown as MarketsService,
    {} as AiMarketJoinService,
  );

  return { app, service };
}

const USER_AUTH: RequestAuth = {
  sessionId: "session-user",
  sessionExpiresAt: "2099-01-01T00:00:00.000Z",
  walletIdentityId: "wallet-user",
  walletAddress: "user-wallet",
  roles: [],
  isAdmin: false,
  permissions: {
    full_access: false,
    manage_agents: false,
  },
};

const ADMIN_AUTH: RequestAuth = {
  ...USER_AUTH,
  sessionId: "session-admin",
  walletIdentityId: "wallet-admin",
  walletAddress: "admin-wallet",
  roles: ["admin"],
  isAdmin: true,
  permissions: {
    full_access: true,
    manage_agents: true,
  },
};

class FakeMarketDisputeService {
  createdDisputes: Array<{
    marketIdOrSlug: string;
    resolutionId: string;
    walletIdentityId: string;
  }> = [];

  async createResolutionDispute(
    marketIdOrSlug: string,
    resolutionId: string,
    input: { walletIdentityId: string },
  ) {
    this.createdDisputes.push({
      marketIdOrSlug,
      resolutionId,
      walletIdentityId: input.walletIdentityId,
    });

    return { data: { id: "dispute-1", status: "open" } };
  }

  async listMarketDisputes(status: string) {
    return { data: [{ id: "dispute-1", status }] };
  }

  async acceptMarketDispute(disputeId: string) {
    if (disputeId === "missing") {
      throw new HttpError(
        404,
        "DISPUTE_NOT_FOUND",
        `Dispute '${disputeId}' was not found.`,
      );
    }

    return { data: { id: disputeId, status: "accepted" } };
  }

  async rejectMarketDispute(disputeId: string) {
    return { data: { id: disputeId, status: "rejected" } };
  }
}
