import type { FastifyReply, FastifyRequest } from "fastify";

import type { RequestAuth } from "../modules/auth/auth.types.js";

declare module "fastify" {
  interface FastifyRequest {
    auth: RequestAuth | null;
  }

  interface FastifyInstance {
    requireAuth(request: FastifyRequest, reply: FastifyReply): RequestAuth | null;
    requireAdmin(request: FastifyRequest, reply: FastifyReply): RequestAuth | null;
    requireWalletAccess(request: FastifyRequest, reply: FastifyReply, walletAddress: string): RequestAuth | null;
  }
}

export {};
