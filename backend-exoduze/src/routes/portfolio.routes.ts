import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { assertValidSolanaWalletAddress } from "../modules/auth/solana.js";
import { PortfolioService } from "../modules/portfolio/portfolio.service.js";

const portfolioParamsSchema = z.object({
  walletAddress: z.string().min(1),
});

const payoutClaimParamsSchema = portfolioParamsSchema.extend({
  payoutId: z.string().min(1),
});

const payoutClaimBodySchema = z.object({
  tx_sig: z.string().trim().min(32).max(128),
});

export async function registerPortfolioRoutes(
  app: FastifyInstance,
  service: PortfolioService,
) {
  app.get("/v1/portfolio/:walletAddress", async (request, reply) => {
    const params = portfolioParamsSchema.parse(request.params);
    const walletAddress = assertValidSolanaWalletAddress(params.walletAddress);
    const auth = app.requireWalletAccess(request, reply, walletAddress);
    if (!auth) {
      return;
    }

    return service.getPortfolio(walletAddress);
  });

  app.post(
    "/v1/portfolio/:walletAddress/payouts/:payoutId/claim",
    async (request, reply) => {
      const params = payoutClaimParamsSchema.parse(request.params);
      const walletAddress = assertValidSolanaWalletAddress(params.walletAddress);
      const auth = app.requireWalletAccess(request, reply, walletAddress);
      if (!auth) {
        return;
      }

      const body = payoutClaimBodySchema.parse(request.body);
      return service.recordPayoutClaim(walletAddress, params.payoutId, {
        txSig: body.tx_sig,
      });
    },
  );
}
