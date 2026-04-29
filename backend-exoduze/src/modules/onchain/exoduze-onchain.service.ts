import * as anchor from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { resolve } from "node:path";

import type { Env } from "../../config/env.js";
import { HttpError } from "../../lib/http-error.js";

const require = createRequire(import.meta.url);
const idl = require("./idl/exoduze_prediction_market.json") as anchor.Idl;
const AnchorBN = require("bn.js");

const CONFIG_SEED = "config";
const MARKET_SEED = "market";
const VAULT_SEED = "vault";

type CreateOnchainMarketInput = {
  marketId: string;
  opensAt: string;
  joinDeadlineAt: string;
  decisionCutoffAt: string;
  closesAt: string;
  resolvesAt: string | null;
  settlementMint?: string | undefined;
};

type CreateOnchainMarketResult = {
  already_created: boolean;
  tx_sig: string | null;
  market_id_hash: string;
  market_pubkey: string;
  vault_pubkey: string;
  config_pubkey: string;
  settlement_mint: string;
};

type ResolveOnchainMarketInput = {
  marketPubkey: string;
  outcome: "YES" | "NO";
};

type ResolveOnchainMarketResult = {
  already_resolved: boolean;
  tx_sig: string | null;
  market_pubkey: string;
  outcome: "YES" | "NO";
};

export type OnchainSignatureStatus = {
  confirmation_status: string | null;
  confirmed: boolean;
  failed: boolean;
  found: boolean;
  slot: number | null;
};

type ProgramRole = "admin" | "oracle";

export class ExoduzeOnchainService {
  private readonly connection: Connection;
  private adminProgram: any | null = null;
  private oracleProgram: any | null = null;
  private adminWallet: anchor.Wallet | null = null;
  private oracleWallet: anchor.Wallet | null = null;

  constructor(private readonly env: Env) {
    this.connection = new Connection(env.SOLANA_RPC_URL, "confirmed");
  }

  get programId(): PublicKey {
    return this.parsePublicKey(this.env.EXODUZE_PROGRAM_ID, "EXODUZE_PROGRAM_ID");
  }

  async createMarket(input: CreateOnchainMarketInput): Promise<CreateOnchainMarketResult> {
    const program = this.getProgram("admin");
    const adminWallet = this.getWallet("admin");
    const settlementMint = this.parsePublicKey(
      input.settlementMint ?? this.env.EXODUZE_SETTLEMENT_MINT,
      "EXODUZE_SETTLEMENT_MINT"
    );
    const tokenProgram = this.parsePublicKey(this.env.EXODUZE_TOKEN_PROGRAM_ID, "EXODUZE_TOKEN_PROGRAM_ID");
    const marketIdHash = this.hashBytes32(`market:${input.marketId}`);
    const [configPda] = this.deriveConfigPda();
    const [marketPda] = this.deriveMarketPda(marketIdHash);
    const [vaultPda] = this.deriveVaultPda(marketPda);
    const existingMarket = await this.connection.getAccountInfo(marketPda, "confirmed");

    const baseResult = {
      market_id_hash: `0x${marketIdHash.toString("hex")}`,
      market_pubkey: marketPda.toBase58(),
      vault_pubkey: vaultPda.toBase58(),
      config_pubkey: configPda.toBase58(),
      settlement_mint: settlementMint.toBase58()
    };

    if (existingMarket) {
      return {
        already_created: true,
        tx_sig: null,
        ...baseResult
      };
    }

    const signature = await program.methods
      .createMarket(
        Array.from(marketIdHash),
        new AnchorBN(this.toUnixSeconds(input.opensAt, "opens_at")),
        new AnchorBN(this.toUnixSeconds(input.joinDeadlineAt, "join_deadline_at")),
        new AnchorBN(this.toUnixSeconds(input.decisionCutoffAt, "decision_cutoff_at")),
        new AnchorBN(this.toUnixSeconds(input.closesAt, "closes_at")),
        new AnchorBN(input.resolvesAt ? this.toUnixSeconds(input.resolvesAt, "resolves_at") : 0)
      )
      .accounts({
        config: configPda,
        market: marketPda,
        settlementMint,
        vault: vaultPda,
        authority: adminWallet.publicKey,
        adminAuthority: adminWallet.publicKey,
        tokenProgram,
        systemProgram: SystemProgram.programId
      })
      .rpc();

    return {
      already_created: false,
      tx_sig: signature,
      ...baseResult
    };
  }

  async resolveMarket(input: ResolveOnchainMarketInput): Promise<ResolveOnchainMarketResult> {
    const program = this.getProgram("oracle");
    const oracleWallet = this.getWallet("oracle");
    const [configPda] = this.deriveConfigPda();
    const marketPubkey = this.parsePublicKey(input.marketPubkey, "marketPubkey");
    const marketAccountInfo = await this.connection.getAccountInfo(marketPubkey, "confirmed");

    if (!marketAccountInfo) {
      throw new HttpError(
        404,
        "ONCHAIN_MARKET_NOT_FOUND",
        `On-chain market '${input.marketPubkey}' was not found.`
      );
    }

    const marketAccount = await program.account.market.fetch(marketPubkey);
    const existingOutcome = this.normalizeSide(marketAccount?.outcome);
    const existingStatus = this.normalizeMarketStatus(marketAccount?.status);

    if (existingStatus === "RESOLVED" || existingOutcome) {
      if (existingOutcome && existingOutcome !== input.outcome) {
        throw new HttpError(
          409,
          "ONCHAIN_MARKET_OUTCOME_CONFLICT",
          `On-chain market '${input.marketPubkey}' is already resolved as '${existingOutcome}'.`
        );
      }

      return {
        already_resolved: true,
        tx_sig: null,
        market_pubkey: marketPubkey.toBase58(),
        outcome: input.outcome
      };
    }

    const signature = await program.methods
      .resolveMarket(this.toOnchainSide(input.outcome))
      .accounts({
        config: configPda,
        market: marketPubkey,
        oracleAuthority: oracleWallet.publicKey
      })
      .rpc();

    return {
      already_resolved: false,
      tx_sig: signature,
      market_pubkey: marketPubkey.toBase58(),
      outcome: input.outcome
    };
  }

  async getSignatureStatus(signature: string): Promise<OnchainSignatureStatus> {
    const status = await this.connection.getSignatureStatus(signature, {
      searchTransactionHistory: true
    });
    const value = status.value;

    if (!value) {
      return {
        confirmation_status: null,
        confirmed: false,
        failed: false,
        found: false,
        slot: null
      };
    }

    const confirmationStatus = value.confirmationStatus ?? null;
    return {
      confirmation_status: confirmationStatus,
      confirmed: value.err === null && ["confirmed", "finalized"].includes(confirmationStatus ?? ""),
      failed: value.err !== null,
      found: true,
      slot: value.slot ?? null
    };
  }

  async findSuccessfulSignatureForAddress(accountAddress: string): Promise<string | null> {
    const publicKey = this.parsePublicKey(accountAddress, "accountAddress");
    const signatures = await this.connection.getSignaturesForAddress(
      publicKey,
      { limit: 10 },
      "confirmed"
    );
    const successfulSignature = signatures.find((signature) => signature.err === null);

    return successfulSignature?.signature ?? null;
  }

  async accountExists(accountAddress: string): Promise<boolean> {
    const publicKey = this.parsePublicKey(accountAddress, "accountAddress");
    const accountInfo = await this.connection.getAccountInfo(publicKey, "confirmed");

    return accountInfo !== null;
  }

  deriveConfigPda(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([Buffer.from(CONFIG_SEED)], this.programId);
  }

  deriveMarketPda(marketIdHash: Buffer): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([Buffer.from(MARKET_SEED), marketIdHash], this.programId);
  }

  deriveVaultPda(market: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([Buffer.from(VAULT_SEED), market.toBuffer()], this.programId);
  }

  isValidPublicKey(value: string | null | undefined): value is string {
    if (!value) {
      return false;
    }

    try {
      new PublicKey(value);
      return true;
    } catch {
      return false;
    }
  }

  private getProgram(role: ProgramRole): any {
    if (role === "admin") {
      if (!this.adminProgram) {
        this.adminProgram = this.createProgramForRole(role);
      }

      return this.adminProgram;
    }

    if (!this.oracleProgram) {
      this.oracleProgram = this.createProgramForRole(role);
    }

    return this.oracleProgram;
  }

  private createProgramForRole(role: ProgramRole) {
    const programId = this.programId.toBase58();
    const provider = new anchor.AnchorProvider(this.connection, this.getWallet(role), {
      commitment: "confirmed"
    });
    return new anchor.Program({ ...idl, address: programId } as anchor.Idl, provider) as any;
  }

  private getWallet(role: ProgramRole): anchor.Wallet {
    if (role === "admin") {
      if (!this.adminWallet) {
        this.adminWallet = this.loadWallet(
          this.env.EXODUZE_ADMIN_KEYPAIR_PATH,
          "EXODUZE_ADMIN_KEYPAIR_PATH",
          "ONCHAIN_SIGNER_NOT_CONFIGURED"
        );
      }

      return this.adminWallet;
    }

    if (!this.oracleWallet) {
      this.oracleWallet = this.loadWallet(
        this.env.EXODUZE_ORACLE_KEYPAIR_PATH ?? this.env.EXODUZE_ADMIN_KEYPAIR_PATH,
        "EXODUZE_ORACLE_KEYPAIR_PATH",
        "ONCHAIN_ORACLE_SIGNER_NOT_CONFIGURED"
      );
    }

    return this.oracleWallet;
  }

  private loadWallet(
    keypairPath: string | undefined,
    envName: string,
    errorCode: string
  ) {
    if (!keypairPath) {
      throw new HttpError(500, errorCode, `${envName} must point to the required on-chain keypair.`);
    }

    const secret = JSON.parse(readFileSync(this.expandHome(keypairPath), "utf8")) as number[];
    return new anchor.Wallet(Keypair.fromSecretKey(Uint8Array.from(secret)));
  }

  private parsePublicKey(value: string | null | undefined, name: string): PublicKey {
    if (!value) {
      throw new HttpError(500, "ONCHAIN_CONFIG_MISSING", `${name} is required for on-chain integration.`);
    }

    try {
      return new PublicKey(value);
    } catch {
      throw new HttpError(500, "ONCHAIN_CONFIG_INVALID", `${name} must be a valid Solana public key.`);
    }
  }

  private hashBytes32(value: string): Buffer {
    return createHash("sha256").update(value).digest();
  }

  private normalizeSide(value: unknown): "YES" | "NO" | null {
    if (!value || typeof value !== "object") {
      return null;
    }

    if ("yes" in value || "Yes" in value) {
      return "YES";
    }

    if ("no" in value || "No" in value) {
      return "NO";
    }

    return null;
  }

  private normalizeMarketStatus(value: unknown): "ACTIVE" | "CANCELLED" | "RESOLVED" | "INVALID" | null {
    if (!value || typeof value !== "object") {
      return null;
    }

    if ("active" in value || "Active" in value) {
      return "ACTIVE";
    }

    if ("cancelled" in value || "Cancelled" in value) {
      return "CANCELLED";
    }

    if ("resolved" in value || "Resolved" in value) {
      return "RESOLVED";
    }

    if ("invalid" in value || "Invalid" in value) {
      return "INVALID";
    }

    return null;
  }

  private toOnchainSide(value: "YES" | "NO") {
    return value === "YES" ? { yes: {} } : { no: {} };
  }

  private toUnixSeconds(value: string, field: string): number {
    const ms = Date.parse(value);
    if (Number.isNaN(ms)) {
      throw new HttpError(400, "INVALID_MARKET_TIMING", `${field} must be a valid ISO date.`);
    }

    return Math.floor(ms / 1_000);
  }

  private expandHome(filePath: string): string {
    if (filePath === "~") {
      return homedir();
    }

    if (filePath.startsWith("~/")) {
      return resolve(homedir(), filePath.slice(2));
    }

    return resolve(filePath);
  }
}

export const defaultTokenProgramId = TOKEN_PROGRAM_ID.toBase58();
