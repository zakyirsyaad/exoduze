import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { assertValidSolanaWalletAddress } from "../modules/auth/solana.js";
import { ExoduzeOnchainService } from "../modules/onchain/exoduze-onchain.service.js";

const treasuryAuthorityBodySchema = z.object({
  treasury_authority: z.string().trim().min(32).max(64)
});

export async function registerSystemRoutes(
  app: FastifyInstance,
  onchainService: ExoduzeOnchainService
) {
  app.get("/v1/admin/system/onchain-config", async (request, reply) => {
    const auth = app.requireAdmin(request, reply);
    if (!auth) {
      return;
    }

    return {
      data: {
        config: await onchainService.getConfig()
      }
    };
  });

  app.post("/v1/admin/system/treasury-authority", async (request, reply) => {
    const auth = app.requireAdmin(request, reply);
    if (!auth) {
      return;
    }

    const body = treasuryAuthorityBodySchema.parse(request.body ?? {});

    return {
      data: await onchainService.updateTreasuryAuthority({
        treasuryAuthority: assertValidSolanaWalletAddress(body.treasury_authority)
      })
    };
  });
}
