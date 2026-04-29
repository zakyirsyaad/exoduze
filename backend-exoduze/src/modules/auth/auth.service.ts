import { randomBytes, randomUUID } from "node:crypto";

import type { PoolClient } from "pg";

import type { Env } from "../../config/env.js";
import type { AppDatabase } from "../../db/database.js";
import { queryOne, queryRows } from "../../db/query.js";
import { createStableId, hashText } from "../../lib/ids.js";
import type { RequestAuth } from "./auth.types.js";
import { assertValidSolanaWalletAddress, buildSolanaAuthMessage, verifySolanaSignedMessage } from "./solana.js";

type AuthChallengeRow = {
  id: string;
  wallet_address: string;
  nonce: string;
  expires_at: string;
  used_at: string | null;
};

type AuthSessionRow = {
  session_id: string;
  session_expires_at: string;
  wallet_identity_id: string;
  wallet_address: string;
};

type WalletIdentityRow = {
  id: string;
  wallet_address: string;
};

export class AuthError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export class AuthService {
  constructor(
    private readonly db: AppDatabase,
    private readonly env: Env
  ) {}

  async createChallenge(walletAddressInput: string) {
    const walletAddress = assertValidSolanaWalletAddress(walletAddressInput);
    const challengeId = `auth_challenge_${randomUUID().replace(/-/g, "")}`;
    const nonce = randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + this.env.AUTH_CHALLENGE_TTL_MINUTES * 60_000).toISOString();

    await this.db.query(
      `
        INSERT INTO auth_challenges (id, wallet_address, nonce, expires_at)
        VALUES ($1, $2, $3, $4)
      `,
      [challengeId, walletAddress, nonce, expiresAt]
    );

    return {
      data: {
        challenge_id: challengeId,
        wallet_address: walletAddress,
        message: buildSolanaAuthMessage({
          walletAddress,
          challengeId,
          nonce,
          expiresAt
        }),
        expires_at: expiresAt
      }
    };
  }

  async verifyChallenge(input: {
    challengeId: string;
    walletAddress: string;
    signature: string;
  }) {
    const walletAddress = assertValidSolanaWalletAddress(input.walletAddress);
    const challenge = await queryOne<AuthChallengeRow>(
      this.db,
      `
        SELECT
          id,
          wallet_address,
          nonce,
          expires_at::text,
          used_at::text
        FROM auth_challenges
        WHERE id = $1 AND wallet_address = $2
        LIMIT 1
      `,
      [input.challengeId, walletAddress]
    );

    if (!challenge) {
      throw new AuthError(404, "CHALLENGE_NOT_FOUND", "Auth challenge was not found for that wallet.");
    }

    if (challenge.used_at) {
      throw new AuthError(409, "CHALLENGE_ALREADY_USED", "This auth challenge has already been used.");
    }

    if (Date.parse(challenge.expires_at) <= Date.now()) {
      throw new AuthError(401, "CHALLENGE_EXPIRED", "This auth challenge has expired.");
    }

    const message = buildSolanaAuthMessage({
      walletAddress,
      challengeId: challenge.id,
      nonce: challenge.nonce,
      expiresAt: challenge.expires_at
    });

    const isValidSignature = verifySolanaSignedMessage({
      walletAddress,
      message,
      signature: input.signature
    });

    if (!isValidSignature) {
      throw new AuthError(401, "INVALID_SIGNATURE", "The provided signature could not be verified.");
    }

    const client = await this.db.connect();
    try {
      await client.query("BEGIN");

      const challengeUpdate = await client.query<{ id: string }>(
        `
          UPDATE auth_challenges
          SET used_at = now()
          WHERE id = $1
            AND wallet_address = $2
            AND used_at IS NULL
            AND expires_at > now()
          RETURNING id
        `,
        [challenge.id, walletAddress]
      );

      if (challengeUpdate.rowCount === 0) {
        throw new AuthError(409, "CHALLENGE_ALREADY_USED", "This auth challenge is no longer valid.");
      }

      const walletIdentity = await this.ensureWalletIdentity(client, walletAddress);
      const sessionToken = randomBytes(32).toString("base64url");
      const sessionId = `auth_session_${randomUUID().replace(/-/g, "")}`;
      const sessionExpiresAt = new Date(Date.now() + this.env.AUTH_SESSION_TTL_HOURS * 60 * 60_000).toISOString();

      await client.query(
        `
          INSERT INTO auth_sessions (id, wallet_identity_id, session_token, expires_at)
          VALUES ($1, $2, $3, $4)
        `,
        [sessionId, walletIdentity.id, hashText(sessionToken), sessionExpiresAt]
      );

      const auth = await this.buildRequestAuth(
        client,
        {
          session_id: sessionId,
          session_expires_at: sessionExpiresAt,
          wallet_identity_id: walletIdentity.id,
          wallet_address: walletAddress
        }
      );

      await client.query("COMMIT");

      return {
        data: {
          access_token: sessionToken,
          token_type: "Bearer",
          expires_at: sessionExpiresAt,
          wallet: {
            wallet_address: auth.walletAddress,
            wallet_identity_id: auth.walletIdentityId
          },
          roles: auth.roles,
          permissions: auth.permissions
        }
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async resolveRequestAuth(token: string) {
    const session = await queryOne<AuthSessionRow>(
      this.db,
      `
        SELECT
          s.id AS session_id,
          s.expires_at::text AS session_expires_at,
          s.wallet_identity_id,
          w.wallet_address
        FROM auth_sessions s
        JOIN wallet_identities w ON w.id = s.wallet_identity_id
        WHERE s.session_token = $1
          AND s.revoked_at IS NULL
          AND s.expires_at > now()
          AND w.is_active = true
        LIMIT 1
      `,
      [hashText(token)]
    );

    if (!session) {
      return null;
    }

    return this.buildRequestAuth(this.db, session);
  }

  async revokeSession(sessionId: string) {
    await this.db.query(
      `
        UPDATE auth_sessions
        SET revoked_at = now()
        WHERE id = $1 AND revoked_at IS NULL
      `,
      [sessionId]
    );
  }

  private async ensureWalletIdentity(client: PoolClient, walletAddress: string) {
    const existing = await queryOne<{ id: string; is_active: boolean }>(
      client,
      `
        SELECT id, is_active
        FROM wallet_identities
        WHERE wallet_address = $1
        LIMIT 1
      `,
      [walletAddress]
    );

    if (existing) {
      if (!existing.is_active) {
        throw new AuthError(403, "WALLET_DISABLED", "This wallet has been disabled.");
      }

      await client.query(
        `
          UPDATE wallet_identities
          SET last_login_at = now(), updated_at = now()
          WHERE id = $1
        `,
        [existing.id]
      );

      return {
        id: existing.id,
        wallet_address: walletAddress
      };
    }

    const walletIdentityId = createStableId("wallet", walletAddress);
    await client.query(
      `
        INSERT INTO wallet_identities (id, wallet_address, is_active, last_login_at)
        VALUES ($1, $2, true, now())
      `,
      [walletIdentityId, walletAddress]
    );

    return {
      id: walletIdentityId,
      wallet_address: walletAddress
    };
  }

  private async buildRequestAuth(
    db: AppDatabase | PoolClient,
    session: AuthSessionRow
  ): Promise<RequestAuth> {
    const boundRoles = await queryRows<{ role: string }>(
      db,
      `
        SELECT role
        FROM role_bindings
        WHERE wallet_identity_id = $1
      `,
      [session.wallet_identity_id]
    );

    const roles = new Set(boundRoles.map((entry) => entry.role));
    const isAdmin = session.wallet_address === this.env.ADMIN_SOLANA_WALLET;

    roles.add("agent_manager");
    if (isAdmin) {
      roles.add("admin");
    }

    return {
      sessionId: session.session_id,
      sessionExpiresAt: session.session_expires_at,
      walletIdentityId: session.wallet_identity_id,
      walletAddress: session.wallet_address,
      roles: [...roles].sort((left, right) => left.localeCompare(right)),
      isAdmin,
      permissions: {
        full_access: isAdmin,
        manage_agents: true
      }
    };
  }
}
