import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { AuthService } from "../modules/auth/auth.service.js";

const createChallengeBodySchema = z.object({
  wallet_address: z.string().min(1)
});

const verifyChallengeBodySchema = z.object({
  challenge_id: z.string().min(1),
  wallet_address: z.string().min(1),
  signature: z.string().min(1)
});

export async function registerAuthRoutes(app: FastifyInstance, service: AuthService) {
  app.post("/v1/auth/challenge", async (request) => {
    const body = createChallengeBodySchema.parse(request.body);
    return service.createChallenge(body.wallet_address);
  });

  app.post("/v1/auth/verify", async (request) => {
    const body = verifyChallengeBodySchema.parse(request.body);
    return service.verifyChallenge({
      challengeId: body.challenge_id,
      walletAddress: body.wallet_address,
      signature: body.signature
    });
  });

  app.get("/v1/auth/me", async (request, reply) => {
    const auth = app.requireAuth(request, reply);
    if (!auth) {
      return;
    }

    return {
      data: {
        wallet: {
          wallet_address: auth.walletAddress,
          wallet_identity_id: auth.walletIdentityId
        },
        session: {
          id: auth.sessionId,
          expires_at: auth.sessionExpiresAt
        },
        roles: auth.roles,
        permissions: auth.permissions
      }
    };
  });

  app.post("/v1/auth/logout", async (request, reply) => {
    const auth = app.requireAuth(request, reply);
    if (!auth) {
      return;
    }

    await service.revokeSession(auth.sessionId);

    return {
      data: {
        revoked: true
      }
    };
  });
}
