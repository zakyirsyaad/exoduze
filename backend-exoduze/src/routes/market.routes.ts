import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { assertValidSolanaWalletAddress } from "../modules/auth/solana.js";
import { AiMarketJoinService } from "../modules/ai/ai-market-join.service.js";
import { MarketsService } from "../modules/markets/markets.service.js";

const marketStatusSchema = z.enum(["draft", "upcoming", "open", "locked", "closed", "resolving", "disputed", "resolved", "cancelled"]);
const isoDateSchema = z.string().datetime({ offset: true });

const listMarketsQuerySchema = z.object({
  category: z.string().optional(),
  topic: z.string().optional(),
  status: marketStatusSchema.optional()
});

const marketDetailQuerySchema = z.object({
  wallet: z.string().optional()
});

const marketAgentJoinBodySchema = z.object({
  user_prompt: z.string().max(8000).nullable().optional()
});

const positiveDecimalSchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/)
  .refine((value) => value.replace(".", "").replace(/^0+/, "") !== "", {
    message: "Amount must be greater than zero."
  });

const positiveIntegerStringSchema = z
  .string()
  .trim()
  .regex(/^\d+$/)
  .refine((value) => BigInt(value) > 0n, {
    message: "Amount must be greater than zero."
  });

const solanaPublicKeySchema = z.string().trim().min(32).max(64);
const solanaSignatureSchema = z.string().trim().min(32).max(128);

const marketAgentStakeBodySchema = z.object({
  commit_included: z.boolean().optional(),
  market_agent_id: z.string().min(1).nullable().optional(),
  onchain_commitment_ref: solanaPublicKeySchema,
  onchain_position_ref: solanaPublicKeySchema,
  stake_amount_base_units: positiveIntegerStringSchema,
  stake_usdc: positiveDecimalSchema,
  tx_sig: solanaSignatureSchema.nullable().optional(),
  user_token_account: solanaPublicKeySchema.nullable().optional(),
  vault_pubkey: solanaPublicKeySchema.nullable().optional()
});

const MARKET_LIVE_WS_POLL_INTERVAL_MS = 3_000;

export async function registerMarketRoutes(
  app: FastifyInstance,
  service: MarketsService,
  aiMarketJoinService: AiMarketJoinService
) {
  app.get(
    "/v1/markets/:marketIdOrSlug/live",
    { websocket: true },
    (socket, request) => {
      const params = z
        .object({ marketIdOrSlug: z.string().min(1) })
        .parse(request.params);
      let lastRevision: string | null = null;
      let intervalHandle: NodeJS.Timeout | null = null;
      let closed = false;

      const stop = () => {
        closed = true;
        if (intervalHandle) {
          clearInterval(intervalHandle);
          intervalHandle = null;
        }
      };

      const pollRevision = async (isInitial = false) => {
        if (closed) {
          return;
        }

        try {
          const revision = await service.getMarketRealtimeRevision(
            params.marketIdOrSlug,
          );

          if (!revision) {
            sendSocketJson(socket, {
              type: "market.not_found",
              marketIdOrSlug: params.marketIdOrSlug,
            });
            closeSocket(socket, 4404, "Market not found.");
            stop();
            return;
          }

          if (isInitial) {
            lastRevision = revision.revision;
            sendSocketJson(socket, {
              type: "market.ready",
              market: {
                id: revision.marketId,
                slug: revision.marketSlug,
              },
              revision: revision.revision,
              revision_at: revision.revisionAt,
            });
            return;
          }

          if (revision.revision !== lastRevision) {
            lastRevision = revision.revision;
            sendSocketJson(socket, {
              type: "market.updated",
              market: {
                id: revision.marketId,
                slug: revision.marketSlug,
              },
              revision: revision.revision,
              revision_at: revision.revisionAt,
            });
          }
        } catch (error) {
          app.log.error(
            { err: error, marketIdOrSlug: params.marketIdOrSlug },
            "Market live websocket polling failed.",
          );
          sendSocketJson(socket, {
            type: "market.error",
            message: "Market live updates failed.",
          });
        }
      };

      socket.on("close", () => {
        stop();
      });

      socket.on("error", (error) => {
        app.log.error(
          { err: error, marketIdOrSlug: params.marketIdOrSlug },
          "Market live websocket connection failed.",
        );
        stop();
      });

      socket.on("message", (rawMessage) => {
        const message = rawMessage.toString();
        if (message === "ping") {
          sendSocketJson(socket, { type: "market.pong" });
        }
      });

      void pollRevision(true);
      intervalHandle = setInterval(() => {
        void pollRevision();
      }, MARKET_LIVE_WS_POLL_INTERVAL_MS);
    },
  );

  app.get("/v1/markets", async (request) => {
    const query = listMarketsQuerySchema.parse(request.query);
    return service.listMarkets({
      category: query.category ?? undefined,
      topic: query.topic ?? undefined,
      status: query.status ?? undefined
    });
  });

  app.post("/v1/markets/:marketIdOrSlug/agents/:agentIdOrSlug/join", async (request, reply) => {
    const auth = app.requireAuth(request, reply);
    if (!auth) {
      return;
    }

    const params = z
      .object({
        marketIdOrSlug: z.string().min(1),
        agentIdOrSlug: z.string().min(1)
      })
      .parse(request.params);
    const body = marketAgentJoinBodySchema.parse(request.body ?? {});

    reply.code(201);
    return aiMarketJoinService.joinAndDecide(auth, params.marketIdOrSlug, params.agentIdOrSlug, {
      userPrompt: body.user_prompt ?? undefined
    });
  });

  app.post("/v1/markets/:marketIdOrSlug/agents/:agentIdOrSlug/stake", async (request, reply) => {
    const auth = app.requireAuth(request, reply);
    if (!auth) {
      return;
    }

    const params = z
      .object({
        marketIdOrSlug: z.string().min(1),
        agentIdOrSlug: z.string().min(1)
      })
      .parse(request.params);
    const body = marketAgentStakeBodySchema.parse(request.body ?? {});

    reply.code(201);
    return aiMarketJoinService.recordStakeConfirmation(auth, params.marketIdOrSlug, params.agentIdOrSlug, {
      commitIncluded: body.commit_included,
      marketAgentId: body.market_agent_id ?? undefined,
      onchainCommitmentRef: body.onchain_commitment_ref,
      onchainPositionRef: body.onchain_position_ref,
      stakeAmountBaseUnits: body.stake_amount_base_units,
      stakeUsdc: body.stake_usdc,
      txSig: body.tx_sig ?? undefined,
      userTokenAccount: body.user_token_account ?? undefined,
      vaultPubkey: body.vault_pubkey ?? undefined
    });
  });

  app.get("/v1/markets/:marketIdOrSlug/agents/:marketAgentId/snapshot", async (request, reply) => {
    const params = z
      .object({
        marketIdOrSlug: z.string().min(1),
        marketAgentId: z.string().min(1)
      })
      .parse(request.params);
    const result = await service.getMarketAgentSnapshot(params.marketIdOrSlug, params.marketAgentId);

    if (!result) {
      return reply.code(404).send({
        error: "SNAPSHOT_NOT_FOUND",
        message: `Snapshot for market agent '${params.marketAgentId}' was not found.`
      });
    }

    return result;
  });

  app.get("/v1/markets/:marketIdOrSlug", async (request, reply) => {
    const params = z.object({ marketIdOrSlug: z.string().min(1) }).parse(request.params);
    const query = marketDetailQuerySchema.parse(request.query);
    const walletAddress = query.wallet ? assertValidSolanaWalletAddress(query.wallet) : undefined;

    if (walletAddress) {
      const auth = app.requireWalletAccess(request, reply, walletAddress);
      if (!auth) {
        return;
      }
    }

    const result = await service.getMarketDetail(params.marketIdOrSlug, walletAddress);

    if (!result) {
      return reply.code(404).send({
        error: "MARKET_NOT_FOUND",
        message: `Market '${params.marketIdOrSlug}' was not found.`
      });
    }

    return result;
  });

  app.get("/v1/markets/:marketIdOrSlug/news", async (request, reply) => {
    const params = z.object({ marketIdOrSlug: z.string().min(1) }).parse(request.params);
    const result = await service.getMarketNews(params.marketIdOrSlug);

    if (!result) {
      return reply.code(404).send({
        error: "MARKET_NOT_FOUND",
        message: `Market '${params.marketIdOrSlug}' was not found.`
      });
    }

    return result;
  });
}

function sendSocketJson(
  socket: { readyState: number; send: (payload: string) => void },
  payload: unknown,
) {
  if (socket.readyState !== 1) {
    return;
  }

  socket.send(JSON.stringify(payload));
}

function closeSocket(
  socket: { readyState: number; close: (code?: number, reason?: string) => void },
  code: number,
  reason: string,
) {
  if (socket.readyState > 1) {
    return;
  }

  socket.close(code, reason);
}
