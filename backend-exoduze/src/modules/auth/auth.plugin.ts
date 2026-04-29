import type { FastifyInstance } from "fastify";

import { AuthService } from "./auth.service.js";
import { assertValidSolanaWalletAddress } from "./solana.js";

export async function registerAuthSupport(
  app: FastifyInstance,
  service: AuthService,
) {
  app.decorateRequest("auth", null);

  app.decorate("requireAuth", (request, reply) => {
    if (!request.auth) {
      reply.code(401).send({
        error: "AUTH_REQUIRED",
        message: "Authentication is required for this endpoint.",
      });
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
      reply.code(403).send({
        error: "ADMIN_REQUIRED",
        message: "Only the configured admin wallet can access this endpoint.",
      });
      return null;
    }

    return auth;
  });

  app.decorate("requireWalletAccess", (request, reply, walletAddress) => {
    const targetWalletAddress = assertValidSolanaWalletAddress(walletAddress);
    const auth = app.requireAuth(request, reply);

    if (!auth) {
      return null;
    }

    if (auth.isAdmin || auth.walletAddress === targetWalletAddress) {
      return auth;
    }

    reply.code(403).send({
      error: "WALLET_ACCESS_FORBIDDEN",
      message:
        "You can only access data for your own wallet unless you are the admin wallet.",
    });
    return null;
  });

  app.addHook("onRequest", async (request, reply) => {
    request.auth = null;

    const authorization = request.headers.authorization;
    if (!authorization) {
      return;
    }

    const [scheme, token] = authorization.split(" ");
    if (scheme !== "Bearer" || !token?.trim()) {
      return reply.code(401).send({
        error: "INVALID_AUTH_HEADER",
        message: "Authorization header must use the format 'Bearer <token>'.",
      });
    }

    const auth = await service.resolveRequestAuth(token.trim());
    if (!auth) {
      return reply.code(401).send({
        error: "INVALID_SESSION",
        message: "Session token is invalid, expired, or has been revoked.",
      });
    }

    request.auth = auth;
  });
}
