import type { FastifyInstance } from "fastify";

export async function registerHealthRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({
    ok: true,
    service: "exoduze-backend",
    timestamp: new Date().toISOString()
  }));
}
