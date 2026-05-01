import { randomUUID } from "node:crypto";

import type { AppDatabase } from "../../db/database.js";

type AuditLogger = {
  error?: (input: unknown, message?: string) => void;
};

type AuditLogInput = {
  action: string;
  actorType: string;
  actorWalletIdentityId?: string | null | undefined;
  after?: Record<string, unknown> | null | undefined;
  before?: Record<string, unknown> | null | undefined;
  entityId: string;
  entityType: string;
  requestId?: string | null | undefined;
};

export async function writeAuditLog(
  db: Pick<AppDatabase, "query">,
  logger: AuditLogger | undefined,
  input: AuditLogInput,
) {
  try {
    await db.query(
      `
        INSERT INTO audit_logs (
          id,
          actor_type,
          actor_wallet_identity_id,
          action,
          entity_type,
          entity_id,
          before_json,
          after_json,
          request_id,
          created_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, now()
        )
      `,
      [
        `audit_${randomUUID()}`,
        input.actorType,
        input.actorWalletIdentityId ?? null,
        input.action,
        input.entityType,
        input.entityId,
        input.before ? JSON.stringify(input.before) : null,
        input.after ? JSON.stringify(input.after) : null,
        input.requestId ?? null,
      ],
    );
  } catch (error) {
    const payload = {
      err: error,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
    };

    if (logger?.error) {
      logger.error(payload, "Audit log write failed.");
      return;
    }

    console.error("Audit log write failed.", payload);
  }
}

