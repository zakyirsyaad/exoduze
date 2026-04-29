import {
  AccountRole,
  address,
  type AccountMeta,
  type Address,
  type Instruction,
} from "@solana/kit"
import { PublicKey } from "@solana/web3.js"

export type PredictionSide = "YES" | "NO"

export type MarketOutcome = PredictionSide | "CANCELLED"

export type ExoduzeProgramConfig = {
  programId: string | null
  settlementMint: string | null
  hasIdl: boolean
}

export type ExoduzeTransactionResult = {
  agentCommitmentPubkey?: string
  positionPubkey?: string
  signature: string
  slot?: bigint
  userTokenAccount?: string
  vaultPubkey?: string
}

export type CommitAgentDecisionInput = {
  agentAuthority: string
  agentId: string
  agentIdHash?: string | null
  marketPubkey: string
  agentCommitmentPubkey?: string | null
  agentCommitmentRef?: string | null
  decisionSide: PredictionSide
  promptHash: string
  configHash: string
  snapshotHash: string
  reasonHash: string
  programId?: string | null
}

export type OpenPositionInput = {
  walletAddress: string
  marketPubkey: string
  marketAgentId: string
  agentCommitmentPubkey?: string | null
  agentCommitmentRef?: string | null
  positionPubkey?: string | null
  positionRef?: string | null
  side?: PredictionSide
  stakeAmountBaseUnits: bigint
  settlementMint?: string | null
  userTokenAccount?: string | null
  vaultPubkey?: string | null
  programId?: string | null
}

export type ResolveMarketInput = {
  marketPubkey: string
  oracleAuthority?: string | null
  outcome: MarketOutcome
  evidenceHash?: string | null
  programId?: string | null
}

export type ClaimPayoutInput = {
  walletAddress: string
  marketPubkey: string
  positionPubkey?: string | null
  positionRef?: string | null
  payoutRef?: string | null
  settlementMint?: string | null
  treasuryTokenAccount?: string | null
  userTokenAccount?: string | null
  vaultPubkey?: string | null
  programId?: string | null
}

export type ExoduzeInstructionBundle = {
  agentCommitmentPubkey?: string
  instructions: ExoduzeInstruction[]
  positionPubkey?: string
  userTokenAccount?: string
  vaultPubkey?: string
}

export type StakeAndJoinBattleInput = {
  walletAddress: string
  marketPubkey: string
  agentId: string
  decisionSide: PredictionSide
  promptHash: string
  configHash: string
  snapshotHash: string
  reasonHash: string
  stakeAmountBaseUnits: bigint
  settlementMint?: string | null
  programId?: string | null
}

export class ExoduzeProgramUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ExoduzeProgramUnavailableError"
  }
}

export function getExoduzeProgramConfig(): ExoduzeProgramConfig {
  return {
    programId: process.env.NEXT_PUBLIC_EXODUZE_PROGRAM_ID ?? null,
    settlementMint: process.env.NEXT_PUBLIC_SETTLEMENT_MINT ?? null,
    hasIdl: true,
  }
}

export function isValidSolanaPublicKey(value: string | null | undefined) {
  if (!value) {
    return false
  }

  try {
    new PublicKey(value)
    return true
  } catch {
    return false
  }
}

export async function commitAgentDecision(
  input: CommitAgentDecisionInput
): Promise<ExoduzeTransactionResult> {
  return rejectUnavailable("commitAgentDecision", input)
}

export async function openPosition(
  input: OpenPositionInput
): Promise<ExoduzeTransactionResult> {
  return rejectUnavailable("openPosition", input)
}

export async function resolveMarket(
  input: ResolveMarketInput
): Promise<ExoduzeTransactionResult> {
  return rejectUnavailable("resolveMarket", input)
}

export async function claimPayout(
  input: ClaimPayoutInput
): Promise<ExoduzeTransactionResult> {
  return rejectUnavailable("claimPayout", input)
}

export async function buildCommitAgentDecisionInstruction(
  input: CommitAgentDecisionInput
): Promise<ExoduzeInstruction> {
  const programId = ensureProgramId(input.programId)
  const marketPubkey = ensurePublicKeyString(
    input.marketPubkey,
    "market pubkey"
  )
  const agentAuthority = ensurePublicKeyString(
    input.agentAuthority,
    "agent authority"
  )
  const agentCommitmentPubkey =
    input.agentCommitmentPubkey ??
    input.agentCommitmentRef ??
    deriveAgentCommitmentPda(marketPubkey, agentAuthority, programId)
  const agentIdHash = input.agentIdHash
    ? hash32FromHex(input.agentIdHash, "agent id hash")
    : await hashUtf8ToBytes32(`agent:${input.agentId}`)

  return {
    accounts: [
      meta(deriveConfigPda(programId), AccountRole.READONLY),
      meta(marketPubkey, AccountRole.READONLY),
      meta(agentCommitmentPubkey, AccountRole.WRITABLE),
      meta(agentAuthority, AccountRole.WRITABLE_SIGNER),
      meta(SYSTEM_PROGRAM_ID, AccountRole.READONLY),
    ],
    data: concatBytes(
      COMMIT_AGENT_DECISION_DISCRIMINATOR,
      agentIdHash,
      hash32FromHex(input.snapshotHash, "snapshot hash"),
      hash32FromHex(input.promptHash, "prompt hash"),
      hash32FromHex(input.configHash, "config hash"),
      hash32FromHex(input.reasonHash, "reason hash"),
      new Uint8Array([sideToByte(input.decisionSide)])
    ),
    programAddress: toAddress(programId),
  }
}

export async function buildOpenPositionInstructions(
  input: OpenPositionInput
): Promise<ExoduzeInstructionBundle> {
  const programId = ensureProgramId(input.programId)
  const marketPubkey = ensurePublicKeyString(
    input.marketPubkey,
    "market pubkey"
  )
  const walletAddress = ensurePublicKeyString(
    input.walletAddress,
    "wallet address"
  )
  const settlementMint = ensureSettlementMint(input.settlementMint)
  const agentCommitmentPubkey =
    input.agentCommitmentPubkey ?? input.agentCommitmentRef

  if (!agentCommitmentPubkey) {
    throw new ExoduzeProgramUnavailableError(
      "This agent does not have an on-chain commitment reference yet."
    )
  }

  const normalizedAgentCommitmentPubkey = ensurePublicKeyString(
    agentCommitmentPubkey,
    "agent commitment pubkey"
  )
  const userTokenAccount = ensurePublicKeyString(
    input.userTokenAccount ??
      deriveAssociatedTokenAddress(walletAddress, settlementMint),
    "user token account"
  )
  const positionPubkey = ensurePublicKeyString(
    input.positionPubkey ??
      input.positionRef ??
      derivePositionPda(
        marketPubkey,
        walletAddress,
        normalizedAgentCommitmentPubkey,
        programId
      ),
    "position pubkey"
  )
  const vaultPubkey = ensurePublicKeyString(
    input.vaultPubkey ?? deriveVaultPda(marketPubkey, programId),
    "vault pubkey"
  )
  const createAtaInstruction = buildCreateAssociatedTokenAccountInstruction({
    ata: userTokenAccount,
    mint: settlementMint,
    owner: walletAddress,
    payer: walletAddress,
  })

  const openPositionInstruction: ExoduzeInstruction = {
    accounts: [
      meta(deriveConfigPda(programId), AccountRole.READONLY),
      meta(marketPubkey, AccountRole.WRITABLE),
      meta(normalizedAgentCommitmentPubkey, AccountRole.READONLY),
      meta(positionPubkey, AccountRole.WRITABLE),
      meta(walletAddress, AccountRole.WRITABLE_SIGNER),
      meta(userTokenAccount, AccountRole.WRITABLE),
      meta(settlementMint, AccountRole.READONLY),
      meta(vaultPubkey, AccountRole.WRITABLE),
      meta(TOKEN_PROGRAM_ID, AccountRole.READONLY),
      meta(SYSTEM_PROGRAM_ID, AccountRole.READONLY),
    ],
    data: concatBytes(
      OPEN_POSITION_DISCRIMINATOR,
      u64ToLittleEndian(input.stakeAmountBaseUnits)
    ),
    programAddress: toAddress(programId),
  }

  return {
    agentCommitmentPubkey: normalizedAgentCommitmentPubkey,
    instructions: [createAtaInstruction, openPositionInstruction],
    positionPubkey,
    userTokenAccount,
    vaultPubkey,
  }
}

export async function buildStakeAndJoinBattleInstructions(
  input: StakeAndJoinBattleInput
): Promise<ExoduzeInstructionBundle> {
  const programId = ensureProgramId(input.programId)
  const agentCommitmentPubkey = deriveAgentCommitmentPda(
    input.marketPubkey,
    input.walletAddress,
    programId
  )
  const commitInstruction = await buildCommitAgentDecisionInstruction({
    agentAuthority: input.walletAddress,
    agentCommitmentPubkey,
    agentId: input.agentId,
    configHash: input.configHash,
    decisionSide: input.decisionSide,
    marketPubkey: input.marketPubkey,
    programId,
    promptHash: input.promptHash,
    reasonHash: input.reasonHash,
    snapshotHash: input.snapshotHash,
  })
  const openPositionBundle = await buildOpenPositionInstructions({
    agentCommitmentPubkey,
    marketAgentId: input.agentId,
    marketPubkey: input.marketPubkey,
    programId,
    settlementMint: input.settlementMint,
    side: input.decisionSide,
    stakeAmountBaseUnits: input.stakeAmountBaseUnits,
    walletAddress: input.walletAddress,
  })

  return {
    ...openPositionBundle,
    agentCommitmentPubkey,
    instructions: [commitInstruction, ...openPositionBundle.instructions],
  }
}

export function buildResolveMarketInstruction(
  input: ResolveMarketInput & { oracleAuthority: string }
): ExoduzeInstruction {
  const programId = ensureProgramId(input.programId)
  const marketPubkey = ensurePublicKeyString(
    input.marketPubkey,
    "market pubkey"
  )
  const oracleAuthority = ensurePublicKeyString(
    input.oracleAuthority,
    "oracle authority"
  )

  return {
    accounts: [
      meta(deriveConfigPda(programId), AccountRole.READONLY),
      meta(marketPubkey, AccountRole.WRITABLE),
      meta(oracleAuthority, AccountRole.READONLY_SIGNER),
    ],
    data: concatBytes(
      RESOLVE_MARKET_DISCRIMINATOR,
      outcomeOptionToBytes(input.outcome)
    ),
    programAddress: toAddress(programId),
  }
}

export function buildClaimPayoutInstructions(
  input: ClaimPayoutInput
): ExoduzeInstructionBundle {
  const programId = ensureProgramId(input.programId)
  const marketPubkey = ensurePublicKeyString(
    input.marketPubkey,
    "market pubkey"
  )
  const walletAddress = ensurePublicKeyString(
    input.walletAddress,
    "wallet address"
  )
  const positionPubkey = input.positionPubkey ?? input.positionRef
  const settlementMint = ensureSettlementMint(input.settlementMint)
  const treasuryTokenAccount = input.treasuryTokenAccount

  if (!positionPubkey) {
    throw new ExoduzeProgramUnavailableError(
      "This payout does not have an on-chain position reference yet."
    )
  }

  if (!treasuryTokenAccount) {
    throw new ExoduzeProgramUnavailableError(
      "Treasury token account is required before claiming payouts."
    )
  }

  const userTokenAccount = ensurePublicKeyString(
    input.userTokenAccount ??
      deriveAssociatedTokenAddress(walletAddress, settlementMint),
    "user token account"
  )
  const vaultPubkey = ensurePublicKeyString(
    input.vaultPubkey ?? deriveVaultPda(marketPubkey, programId),
    "vault pubkey"
  )
  const createAtaInstruction = buildCreateAssociatedTokenAccountInstruction({
    ata: userTokenAccount,
    mint: settlementMint,
    owner: walletAddress,
    payer: walletAddress,
  })

  return {
    instructions: [
      createAtaInstruction,
      {
        accounts: [
          meta(deriveConfigPda(programId), AccountRole.READONLY),
          meta(marketPubkey, AccountRole.READONLY),
          meta(positionPubkey, AccountRole.WRITABLE),
          meta(walletAddress, AccountRole.WRITABLE_SIGNER),
          meta(userTokenAccount, AccountRole.WRITABLE),
          meta(treasuryTokenAccount, AccountRole.WRITABLE),
          meta(settlementMint, AccountRole.READONLY),
          meta(vaultPubkey, AccountRole.WRITABLE),
          meta(TOKEN_PROGRAM_ID, AccountRole.READONLY),
        ],
        data: CLAIM_PAYOUT_DISCRIMINATOR,
        programAddress: toAddress(programId),
      },
    ],
    positionPubkey,
    userTokenAccount,
    vaultPubkey,
  }
}

export function deriveConfigPda(programId = ensureProgramId()) {
  return derivePda([utf8Bytes(CONFIG_SEED)], programId)
}

export function deriveAgentCommitmentPda(
  marketPubkey: string,
  agentAuthority: string,
  programId = ensureProgramId()
) {
  return derivePda(
    [
      utf8Bytes(AGENT_COMMITMENT_SEED),
      publicKeyBytes(marketPubkey, "market pubkey"),
      publicKeyBytes(agentAuthority, "agent authority"),
    ],
    programId
  )
}

export function derivePositionPda(
  marketPubkey: string,
  walletAddress: string,
  agentCommitmentPubkey: string,
  programId = ensureProgramId()
) {
  return derivePda(
    [
      utf8Bytes(POSITION_SEED),
      publicKeyBytes(marketPubkey, "market pubkey"),
      publicKeyBytes(walletAddress, "wallet address"),
      publicKeyBytes(agentCommitmentPubkey, "agent commitment pubkey"),
    ],
    programId
  )
}

export function deriveVaultPda(
  marketPubkey: string,
  programId = ensureProgramId()
) {
  return derivePda(
    [utf8Bytes(VAULT_SEED), publicKeyBytes(marketPubkey, "market pubkey")],
    programId
  )
}

export function deriveAssociatedTokenAddress(
  owner: string,
  mint: string,
  tokenProgram = TOKEN_PROGRAM_ID
) {
  return derivePda(
    [
      publicKeyBytes(owner, "token account owner"),
      publicKeyBytes(tokenProgram, "token program"),
      publicKeyBytes(mint, "settlement mint"),
    ],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )
}

function rejectUnavailable(
  methodName: string,
  input: unknown
): Promise<ExoduzeTransactionResult> {
  void methodName
  void input

  throw new ExoduzeProgramUnavailableError(
    "Use the wallet-aware Exoduze hooks to send on-chain transactions."
  )
}

type ExoduzeInstruction = Instruction & {
  accounts: AccountMeta[]
  data: Uint8Array
  programAddress: Address
}

const CONFIG_SEED = "config"
const AGENT_COMMITMENT_SEED = "agent_commitment"
const POSITION_SEED = "position"
const VAULT_SEED = "vault"
const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111"
const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
const ASSOCIATED_TOKEN_PROGRAM_ID =
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"

const COMMIT_AGENT_DECISION_DISCRIMINATOR = new Uint8Array([
  222, 144, 164, 98, 43, 216, 162, 18,
])
const OPEN_POSITION_DISCRIMINATOR = new Uint8Array([
  135, 128, 47, 77, 15, 152, 240, 49,
])
const RESOLVE_MARKET_DISCRIMINATOR = new Uint8Array([
  155, 23, 80, 173, 46, 74, 23, 239,
])
const CLAIM_PAYOUT_DISCRIMINATOR = new Uint8Array([
  127, 240, 132, 62, 227, 198, 146, 133,
])

function ensureProgramId(programId?: string | null) {
  const resolvedProgramId = programId ?? getExoduzeProgramConfig().programId

  if (!resolvedProgramId) {
    throw new ExoduzeProgramUnavailableError(
      "Exoduze smart contract program id is not configured. Set NEXT_PUBLIC_EXODUZE_PROGRAM_ID before sending transactions."
    )
  }

  return ensurePublicKeyString(resolvedProgramId, "program id")
}

function ensureSettlementMint(settlementMint?: string | null) {
  const resolvedSettlementMint =
    settlementMint ?? getExoduzeProgramConfig().settlementMint

  if (!resolvedSettlementMint) {
    throw new ExoduzeProgramUnavailableError(
      "Settlement mint is not configured. Set NEXT_PUBLIC_SETTLEMENT_MINT before staking."
    )
  }

  return ensurePublicKeyString(resolvedSettlementMint, "settlement mint")
}

function ensurePublicKeyString(value: string, label: string) {
  try {
    return new PublicKey(value).toBase58()
  } catch {
    throw new ExoduzeProgramUnavailableError(
      `${label} must be a valid Solana public key.`
    )
  }
}

function publicKeyBytes(value: string, label: string) {
  return new PublicKey(ensurePublicKeyString(value, label)).toBytes()
}

function toAddress(value: string) {
  return address(ensurePublicKeyString(value, "address"))
}

function meta(value: string, role: AccountRole): AccountMeta {
  return {
    address: toAddress(value),
    role,
  }
}

function buildCreateAssociatedTokenAccountInstruction(input: {
  ata: string
  mint: string
  owner: string
  payer: string
}): ExoduzeInstruction {
  return {
    accounts: [
      meta(input.payer, AccountRole.WRITABLE_SIGNER),
      meta(input.ata, AccountRole.WRITABLE),
      meta(input.owner, AccountRole.READONLY),
      meta(input.mint, AccountRole.READONLY),
      meta(SYSTEM_PROGRAM_ID, AccountRole.READONLY),
      meta(TOKEN_PROGRAM_ID, AccountRole.READONLY),
    ],
    data: new Uint8Array([1]),
    programAddress: toAddress(ASSOCIATED_TOKEN_PROGRAM_ID),
  }
}

function derivePda(seeds: Uint8Array[], programId: string) {
  const [publicKey] = PublicKey.findProgramAddressSync(
    seeds,
    new PublicKey(ensurePublicKeyString(programId, "program id"))
  )

  return publicKey.toBase58()
}

function concatBytes(...chunks: Uint8Array[]) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0)
  const output = new Uint8Array(length)
  let offset = 0

  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }

  return output
}

function hash32FromHex(value: string, label: string) {
  const normalizedValue = value.trim().replace(/^0x/i, "")

  if (!/^[a-f0-9]{64}$/i.test(normalizedValue)) {
    throw new ExoduzeProgramUnavailableError(
      `${label} must be a 32-byte hex string.`
    )
  }

  const bytes = new Uint8Array(32)

  for (let index = 0; index < normalizedValue.length; index += 2) {
    bytes[index / 2] = Number.parseInt(
      normalizedValue.slice(index, index + 2),
      16
    )
  }

  return bytes
}

async function hashUtf8ToBytes32(value: string) {
  const cryptoApi = globalThis.crypto?.subtle

  if (!cryptoApi) {
    throw new ExoduzeProgramUnavailableError(
      "This browser cannot hash the agent id for the on-chain commitment."
    )
  }

  const bytes = utf8Bytes(value)
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  const digest = await cryptoApi.digest("SHA-256", buffer)

  return new Uint8Array(digest)
}

function utf8Bytes(value: string) {
  return new TextEncoder().encode(value)
}

function u64ToLittleEndian(value: bigint) {
  if (value < BigInt(0) || value > BigInt("18446744073709551615")) {
    throw new ExoduzeProgramUnavailableError(
      "Stake amount must fit inside an unsigned 64-bit integer."
    )
  }

  const output = new Uint8Array(8)
  new DataView(output.buffer).setBigUint64(0, value, true)

  return output
}

function sideToByte(side: PredictionSide) {
  return side === "YES" ? 0 : 1
}

function outcomeOptionToBytes(outcome: MarketOutcome) {
  if (outcome === "CANCELLED") {
    return new Uint8Array([0])
  }

  return new Uint8Array([1, sideToByte(outcome)])
}

// TODO: When backend tx mirror endpoints exist, post confirmed signatures from these adapter functions in one place.
