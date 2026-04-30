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
const AGENT_COMMITMENT_SEED = "agent_commitment";
const POSITION_SEED = "position";

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

type CancelOnchainMarketInput = {
  marketPubkey: string;
};

type CancelOnchainMarketResult = {
  already_cancelled: boolean;
  tx_sig: string | null;
  market_pubkey: string;
  status: "CANCELLED";
};

export type OnchainConfigSummary = {
  config_pubkey: string;
  admin_authority: string;
  oracle_authority: string;
  treasury_authority: string;
  fee_bps: number;
  paused: boolean;
};

type UpdateTreasuryAuthorityInput = {
  treasuryAuthority: string;
};

type UpdateTreasuryAuthorityResult = OnchainConfigSummary & {
  already_set: boolean;
  tx_sig: string | null;
};

export type OnchainSignatureStatus = {
  confirmation_status: string | null;
  confirmed: boolean;
  failed: boolean;
  found: boolean;
  slot: number | null;
};

export type OnchainPositionAccount = {
  agent_commitment: string;
  claimed_amount_base_units: string;
  market: string;
  side: "YES" | "NO" | null;
  stake_amount_base_units: string;
  status: "OPEN" | "CLAIMED" | "REFUNDED" | null;
  user: string;
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

  async cancelMarket(input: CancelOnchainMarketInput): Promise<CancelOnchainMarketResult> {
    const program = this.getProgram("admin");
    const adminWallet = this.getWallet("admin");
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
    const existingStatus = this.normalizeMarketStatus(marketAccount?.status);

    if (existingStatus === "CANCELLED") {
      return {
        already_cancelled: true,
        tx_sig: null,
        market_pubkey: marketPubkey.toBase58(),
        status: "CANCELLED"
      };
    }

    if (existingStatus && existingStatus !== "ACTIVE") {
      throw new HttpError(
        409,
        "ONCHAIN_MARKET_CANCEL_CONFLICT",
        `On-chain market '${input.marketPubkey}' is already '${existingStatus.toLowerCase()}'.`
      );
    }

    const signature = await program.methods
      .cancelMarket()
      .accounts({
        config: configPda,
        market: marketPubkey,
        authority: adminWallet.publicKey
      })
      .rpc();

    return {
      already_cancelled: false,
      tx_sig: signature,
      market_pubkey: marketPubkey.toBase58(),
      status: "CANCELLED"
    };
  }

  async getConfig(): Promise<OnchainConfigSummary | null> {
    const program = this.getProgram("admin");
    const configState = await this.fetchConfigState(program);

    if (!configState) {
      return null;
    }

    return this.toConfigSummary(configState.configPda, configState.configAccount);
  }

  async updateTreasuryAuthority(
    input: UpdateTreasuryAuthorityInput
  ): Promise<UpdateTreasuryAuthorityResult> {
    const program = this.getProgram("admin");
    const adminWallet = this.getWallet("admin");
    const treasuryAuthority = this.parsePublicKey(input.treasuryAuthority, "treasuryAuthority");
    const configState = await this.fetchConfigState(program);

    if (!configState) {
      throw new HttpError(404, "ONCHAIN_CONFIG_NOT_FOUND", "On-chain config was not found.");
    }

    const currentConfig = this.toConfigSummary(configState.configPda, configState.configAccount);

    if (currentConfig.treasury_authority === treasuryAuthority.toBase58()) {
      return {
        already_set: true,
        tx_sig: null,
        ...currentConfig
      };
    }

    const signature = await program.methods
      .updateTreasuryAuthority(treasuryAuthority)
      .accounts({
        config: configState.configPda,
        adminAuthority: adminWallet.publicKey
      })
      .rpc();

    const updatedConfigState = await this.fetchConfigState(program);

    if (!updatedConfigState) {
      throw new HttpError(
        500,
        "ONCHAIN_CONFIG_MISSING",
        "On-chain config disappeared after updating treasury authority."
      );
    }

    return {
      already_set: false,
      tx_sig: signature,
      ...this.toConfigSummary(updatedConfigState.configPda, updatedConfigState.configAccount)
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

  async isAccountOwnedByCurrentProgram(accountAddress: string): Promise<boolean> {
    const publicKey = this.parsePublicKey(accountAddress, "accountAddress");
    const accountInfo = await this.connection.getAccountInfo(publicKey, "confirmed");

    return accountInfo?.owner.equals(this.programId) ?? false;
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

  deriveAgentCommitmentPda(marketAddress: string, agentAuthorityAddress: string): string {
    const marketPubkey = this.parsePublicKey(marketAddress, "marketAddress");
    const agentAuthority = this.parsePublicKey(agentAuthorityAddress, "agentAuthorityAddress");
    const [commitmentPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from(AGENT_COMMITMENT_SEED),
        marketPubkey.toBuffer(),
        agentAuthority.toBuffer()
      ],
      this.programId
    );

    return commitmentPda.toBase58();
  }

  derivePositionPda(marketAddress: string, userAddress: string, agentCommitmentAddress: string): string {
    const marketPubkey = this.parsePublicKey(marketAddress, "marketAddress");
    const userPubkey = this.parsePublicKey(userAddress, "userAddress");
    const agentCommitmentPubkey = this.parsePublicKey(
      agentCommitmentAddress,
      "agentCommitmentAddress"
    );
    const [positionPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from(POSITION_SEED),
        marketPubkey.toBuffer(),
        userPubkey.toBuffer(),
        agentCommitmentPubkey.toBuffer()
      ],
      this.programId
    );

    return positionPda.toBase58();
  }

  async getPosition(accountAddress: string): Promise<OnchainPositionAccount | null> {
    const program = this.getProgram("admin");
    const publicKey = this.parsePublicKey(accountAddress, "accountAddress");
    const accountInfo = await this.connection.getAccountInfo(publicKey, "confirmed");

    if (!accountInfo) {
      return null;
    }

    const positionAccount = await program.account.position.fetch(publicKey);

    return {
      agent_commitment: this.asPublicKey(
        this.readAccountField(positionAccount, "agentCommitment", "agent_commitment"),
        "position.agent_commitment"
      ).toBase58(),
      claimed_amount_base_units: this.asBigInt(
        this.readAccountField(positionAccount, "claimedAmount", "claimed_amount"),
        "position.claimed_amount"
      ).toString(),
      market: this.asPublicKey(
        this.readAccountField(positionAccount, "market"),
        "position.market"
      ).toBase58(),
      side: this.normalizeSide(this.readAccountField(positionAccount, "side")),
      stake_amount_base_units: this.asBigInt(
        this.readAccountField(positionAccount, "stakeAmount", "stake_amount"),
        "position.stake_amount"
      ).toString(),
      status: this.normalizePositionStatus(this.readAccountField(positionAccount, "status")),
      user: this.asPublicKey(
        this.readAccountField(positionAccount, "user"),
        "position.user"
      ).toBase58()
    };
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

  private async fetchConfigState(program: any): Promise<{ configPda: PublicKey; configAccount: any } | null> {
    const [configPda] = this.deriveConfigPda();
    const configAccountInfo = await this.connection.getAccountInfo(configPda, "confirmed");

    if (!configAccountInfo) {
      return null;
    }

    const configAccount = await program.account.config.fetch(configPda);

    return {
      configPda,
      configAccount
    };
  }

  private toConfigSummary(configPda: PublicKey, configAccount: any): OnchainConfigSummary {
    return {
      config_pubkey: configPda.toBase58(),
      admin_authority: this.asPublicKey(
        this.readAccountField(configAccount, "adminAuthority", "admin_authority"),
        "config.admin_authority"
      ).toBase58(),
      oracle_authority: this.asPublicKey(
        this.readAccountField(configAccount, "oracleAuthority", "oracle_authority"),
        "config.oracle_authority"
      ).toBase58(),
      treasury_authority: this.asPublicKey(
        this.readAccountField(configAccount, "treasuryAuthority", "treasury_authority"),
        "config.treasury_authority"
      ).toBase58(),
      fee_bps: this.asNumber(
        this.readAccountField(configAccount, "feeBps", "fee_bps"),
        "config.fee_bps"
      ),
      paused: this.asBoolean(this.readAccountField(configAccount, "paused"), "config.paused")
    };
  }

  private readAccountField(account: unknown, ...keys: string[]): unknown {
    if (!account || typeof account !== "object") {
      return undefined;
    }

    const record = account as Record<string, unknown>;

    for (const key of keys) {
      if (record[key] !== undefined) {
        return record[key];
      }
    }

    return undefined;
  }

  private asPublicKey(value: unknown, field: string): PublicKey {
    if (value instanceof PublicKey) {
      return value;
    }

    if (typeof value === "string") {
      return this.parsePublicKey(value, field);
    }

    if (
      value &&
      typeof value === "object" &&
      "toBase58" in value &&
      typeof (value as { toBase58?: unknown }).toBase58 === "function"
    ) {
      return this.parsePublicKey((value as { toBase58: () => string }).toBase58(), field);
    }

    throw new HttpError(500, "ONCHAIN_CONFIG_INVALID", `${field} must be a valid Solana public key.`);
  }

  private asNumber(value: unknown, field: string): number {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "bigint") {
      return Number(value);
    }

    if (
      value &&
      typeof value === "object" &&
      "toNumber" in value &&
      typeof (value as { toNumber?: unknown }).toNumber === "function"
    ) {
      return (value as { toNumber: () => number }).toNumber();
    }

    if (typeof value === "string" && value.trim()) {
      const parsedValue = Number(value);

      if (Number.isFinite(parsedValue)) {
        return parsedValue;
      }
    }

    throw new HttpError(500, "ONCHAIN_CONFIG_INVALID", `${field} must be numeric.`);
  }

  private asBigInt(value: unknown, field: string): bigint {
    if (typeof value === "bigint") {
      return value;
    }

    if (typeof value === "number" && Number.isSafeInteger(value)) {
      return BigInt(value);
    }

    if (
      value &&
      typeof value === "object" &&
      "toString" in value &&
      typeof (value as { toString?: unknown }).toString === "function"
    ) {
      const normalized = (value as { toString: () => string }).toString().trim();

      if (/^\d+$/.test(normalized)) {
        return BigInt(normalized);
      }
    }

    if (typeof value === "string" && /^\d+$/.test(value.trim())) {
      return BigInt(value.trim());
    }

    throw new HttpError(500, "ONCHAIN_CONFIG_INVALID", `${field} must be an integer.`);
  }

  private asBoolean(value: unknown, field: string): boolean {
    if (typeof value === "boolean") {
      return value;
    }

    throw new HttpError(500, "ONCHAIN_CONFIG_INVALID", `${field} must be boolean.`);
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

  private normalizePositionStatus(value: unknown): "OPEN" | "CLAIMED" | "REFUNDED" | null {
    if (!value || typeof value !== "object") {
      return null;
    }

    if ("open" in value || "Open" in value) {
      return "OPEN";
    }

    if ("claimed" in value || "Claimed" in value) {
      return "CLAIMED";
    }

    if ("refunded" in value || "Refunded" in value) {
      return "REFUNDED";
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
