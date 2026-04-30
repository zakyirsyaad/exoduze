const anchor = require("@coral-xyz/anchor")
const { createHash } = require("crypto")
const assert = require("node:assert/strict")
const idl = require("../idl/exoduze_prediction_market.json")
const {
  TOKEN_PROGRAM_ID,
  createMint,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} = require("@solana/spl-token")

const { BN, web3 } = anchor
const {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey: SolanaPublicKey,
  SystemProgram,
} = web3

const CONFIG_SEED = "config"
const MARKET_SEED = "market"
const VAULT_SEED = "vault"
const AGENT_COMMITMENT_SEED = "agent_commitment"
const POSITION_SEED = "position"
const TOKEN_DECIMALS = 6
const FEE_BPS = 100

describe("exoduze_prediction_market", function () {
  this.timeout(180_000)

  const provider = anchor.AnchorProvider.env()
  anchor.setProvider(provider)

  const deployedProgramId = new SolanaPublicKey(process.env.EXODUZE_TEST_PROGRAM_ID)
  const testIdl = {
    ...idl,
    address: deployedProgramId.toBase58(),
  }
  const program = new anchor.Program(testIdl, provider)
  const payer = provider.wallet.payer
  const oracleAuthority = Keypair.generate()
  const treasuryAuthority = Keypair.generate()

  const [configPda] = SolanaPublicKey.findProgramAddressSync(
    [Buffer.from(CONFIG_SEED)],
    program.programId
  )

  let settlementMint
  let treasuryTokenAccount

  before(async () => {
    await Promise.all([
      airdrop(oracleAuthority.publicKey),
      airdrop(treasuryAuthority.publicKey),
    ])

    settlementMint = await createMint(
      provider.connection,
      payer,
      payer.publicKey,
      null,
      TOKEN_DECIMALS
    )

    treasuryTokenAccount = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        payer,
        settlementMint,
        treasuryAuthority.publicKey
      )
    ).address

    await program.methods
      .initializeConfig(
        oracleAuthority.publicKey,
        treasuryAuthority.publicKey,
        FEE_BPS
      )
      .accounts({
        config: configPda,
        admin: payer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc()
  })

  afterEach(async () => {
    await ensureProgramUnpaused()
  })

  it("creates, resolves, and pays out a market with protocol fees", async () => {
    const market = await createMarket("resolved-market")
    const yesParticipant = await createParticipant(1_000_000_000n)
    const noParticipant = await createParticipant(1_000_000_000n)
    const yesStake = 400_000_000n
    const noStake = 600_000_000n

    const yesCommitmentPda = await commitAgentDecision(
      market.marketPda,
      yesParticipant.keypair,
      "yes",
      "alpha-agent"
    )
    const noCommitmentPda = await commitAgentDecision(
      market.marketPda,
      noParticipant.keypair,
      "no",
      "beta-agent"
    )

    const yesPositionPda = await openPosition(
      market.marketPda,
      market.vaultPda,
      yesCommitmentPda,
      yesParticipant,
      yesStake
    )
    const noPositionPda = await openPosition(
      market.marketPda,
      market.vaultPda,
      noCommitmentPda,
      noParticipant,
      noStake
    )

    const marketAccountBeforeResolution = await program.account.market.fetch(
      market.marketPda
    )
    assert.equal(readEnumVariant(marketAccountBeforeResolution.status), "active")
    assert.equal(
      readU64(marketAccountBeforeResolution.totalYesStake).toString(),
      yesStake.toString()
    )
    assert.equal(
      readU64(marketAccountBeforeResolution.totalNoStake).toString(),
      noStake.toString()
    )
    assert.equal(
      readU64(marketAccountBeforeResolution.totalStake).toString(),
      (yesStake + noStake).toString()
    )

    await resolveWhenReady(market.marketPda, "yes")

    const winnerBalanceBeforeClaim = (
      await getAccount(provider.connection, yesParticipant.tokenAccount)
    ).amount
    const loserBalanceBeforeClaim = (
      await getAccount(provider.connection, noParticipant.tokenAccount)
    ).amount
    const treasuryBalanceBeforeClaim = (
      await getAccount(provider.connection, treasuryTokenAccount)
    ).amount

    await claimPayout(
      market.marketPda,
      market.vaultPda,
      yesPositionPda,
      yesParticipant
    )
    await claimPayout(
      market.marketPda,
      market.vaultPda,
      noPositionPda,
      noParticipant
    )

    const winnerBalanceAfterClaim = (
      await getAccount(provider.connection, yesParticipant.tokenAccount)
    ).amount
    const loserBalanceAfterClaim = (
      await getAccount(provider.connection, noParticipant.tokenAccount)
    ).amount
    const treasuryBalanceAfterClaim = (
      await getAccount(provider.connection, treasuryTokenAccount)
    ).amount
    const vaultBalanceAfterClaim = (
      await getAccount(provider.connection, market.vaultPda)
    ).amount

    assert.equal(
      (winnerBalanceAfterClaim - winnerBalanceBeforeClaim).toString(),
      "990000000"
    )
    assert.equal(
      (loserBalanceAfterClaim - loserBalanceBeforeClaim).toString(),
      "0"
    )
    assert.equal(
      (treasuryBalanceAfterClaim - treasuryBalanceBeforeClaim).toString(),
      "10000000"
    )
    assert.equal(vaultBalanceAfterClaim.toString(), "0")

    const marketAccountAfterResolution = await program.account.market.fetch(
      market.marketPda
    )
    const winnerPosition = await program.account.position.fetch(yesPositionPda)
    const loserPosition = await program.account.position.fetch(noPositionPda)

    assert.equal(readEnumVariant(marketAccountAfterResolution.status), "resolved")
    assert.equal(readEnumVariant(marketAccountAfterResolution.outcome), "yes")
    assert.equal(readEnumVariant(winnerPosition.status), "claimed")
    assert.equal(readEnumVariant(loserPosition.status), "claimed")
    assert.equal(readU64(winnerPosition.claimedAmount).toString(), "990000000")
    assert.equal(readU64(loserPosition.claimedAmount).toString(), "0")
  })

  it("cancels an active market and refunds the stake", async () => {
    const market = await createMarket("cancelled-market")
    const participant = await createParticipant(500_000_000n)
    const stakeAmount = 250_000_000n

    const commitmentPda = await commitAgentDecision(
      market.marketPda,
      participant.keypair,
      "yes",
      "refund-agent"
    )
    const positionPda = await openPosition(
      market.marketPda,
      market.vaultPda,
      commitmentPda,
      participant,
      stakeAmount
    )

    const treasuryBalanceBeforeClaim = (
      await getAccount(provider.connection, treasuryTokenAccount)
    ).amount
    const userBalanceBeforeClaim = (
      await getAccount(provider.connection, participant.tokenAccount)
    ).amount

    await program.methods
      .cancelMarket()
      .accounts({
        config: configPda,
        market: market.marketPda,
        authority: payer.publicKey,
      })
      .rpc()

    await claimPayout(
      market.marketPda,
      market.vaultPda,
      positionPda,
      participant
    )

    const treasuryBalanceAfterClaim = (
      await getAccount(provider.connection, treasuryTokenAccount)
    ).amount
    const userBalanceAfterClaim = (
      await getAccount(provider.connection, participant.tokenAccount)
    ).amount
    const positionAccount = await program.account.position.fetch(positionPda)
    const marketAccount = await program.account.market.fetch(market.marketPda)

    assert.equal(
      (userBalanceAfterClaim - userBalanceBeforeClaim).toString(),
      stakeAmount.toString()
    )
    assert.equal(
      treasuryBalanceAfterClaim.toString(),
      treasuryBalanceBeforeClaim.toString()
    )
    assert.equal(readEnumVariant(positionAccount.status), "refunded")
    assert.equal(
      readU64(positionAccount.claimedAmount).toString(),
      stakeAmount.toString()
    )
    assert.equal(readEnumVariant(marketAccount.status), "cancelled")
  })

  it("rejects resolving a market before its close window", async () => {
    const market = await createMarket("resolve-too-early")

    await expectAnchorError(
      () =>
        program.methods
          .resolveMarket(toAnchorSide("yes"))
          .accounts({
            config: configPda,
            market: market.marketPda,
            oracleAuthority: oracleAuthority.publicKey,
          })
          .signers([oracleAuthority])
          .rpc(),
      ["MarketNotClosed", "Market is not closed yet"]
    )
  })

  it("blocks create, commit, and open flows while paused", async () => {
    const market = await createMarket("paused-operations")
    const committedParticipant = await createParticipant(500_000_000n)
    const pendingParticipant = await createParticipant(500_000_000n)
    const commitmentPda = await commitAgentDecision(
      market.marketPda,
      committedParticipant.keypair,
      "yes",
      "paused-agent"
    )

    await pauseProgram()

    await expectAnchorError(
      () => createMarket("blocked-by-pause"),
      ["ProgramPaused", "Program is paused"]
    )

    await expectAnchorError(
      () =>
        commitAgentDecision(
          market.marketPda,
          pendingParticipant.keypair,
          "no",
          "paused-new-agent"
        ),
      ["ProgramPaused", "Program is paused"]
    )

    await expectAnchorError(
      () =>
        openPosition(
          market.marketPda,
          market.vaultPda,
          commitmentPda,
          committedParticipant,
          100_000_000n
        ),
      ["ProgramPaused", "Program is paused"]
    )
  })

  it("rejects unauthorized admin and oracle actions", async () => {
    const unauthorizedAdmin = Keypair.generate()
    const unauthorizedOracle = Keypair.generate()
    const market = await createMarket("unauthorized-actions")

    await Promise.all([
      airdrop(unauthorizedAdmin.publicKey),
      airdrop(unauthorizedOracle.publicKey),
    ])

    await expectAnchorError(
      () =>
        program.methods
          .pause()
          .accounts({
            config: configPda,
            adminAuthority: unauthorizedAdmin.publicKey,
          })
          .signers([unauthorizedAdmin])
          .rpc(),
      ["Unauthorized", "Caller is not authorized for this instruction"]
    )

    await expectAnchorError(
      () =>
        program.methods
          .resolveMarket(toAnchorSide("yes"))
          .accounts({
            config: configPda,
            market: market.marketPda,
            oracleAuthority: unauthorizedOracle.publicKey,
          })
          .signers([unauthorizedOracle])
          .rpc(),
      ["Unauthorized", "Caller is not authorized for this instruction"]
    )
  })

  it("rejects recommitting an agent with a different on-chain payload", async () => {
    const market = await createMarket("recommit-mismatch")
    const participant = await createParticipant(250_000_000n)

    await commitAgentDecision(
      market.marketPda,
      participant.keypair,
      "yes",
      "immutable-agent"
    )

    await expectAnchorError(
      () =>
        commitAgentDecision(
          market.marketPda,
          participant.keypair,
          "no",
          "immutable-agent"
        ),
      ["InvalidAgentCommitment", "Agent commitment does not match the market"]
    )
  })

  it("rejects claiming the same position twice", async () => {
    const market = await createMarket("double-claim")
    const participant = await createParticipant(500_000_000n)
    const stakeAmount = 200_000_000n
    const commitmentPda = await commitAgentDecision(
      market.marketPda,
      participant.keypair,
      "yes",
      "double-claim-agent"
    )
    const positionPda = await openPosition(
      market.marketPda,
      market.vaultPda,
      commitmentPda,
      participant,
      stakeAmount
    )

    await program.methods
      .cancelMarket()
      .accounts({
        config: configPda,
        market: market.marketPda,
        authority: payer.publicKey,
      })
      .rpc()

    await claimPayout(
      market.marketPda,
      market.vaultPda,
      positionPda,
      participant
    )

    await expectAnchorError(
      () =>
        claimPayout(
          market.marketPda,
          market.vaultPda,
          positionPda,
          participant
        ),
      ["PositionAlreadyClaimed", "Position is already claimed or refunded"]
    )
  })

  it("updates the treasury authority and persists it in config", async () => {
    const nextTreasuryAuthority = Keypair.generate()
    await airdrop(nextTreasuryAuthority.publicKey)

    const nextTreasuryTokenAccount = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        payer,
        settlementMint,
        nextTreasuryAuthority.publicKey
      )
    ).address

    await program.methods
      .updateTreasuryAuthority(nextTreasuryAuthority.publicKey)
      .accounts({
        config: configPda,
        adminAuthority: payer.publicKey,
      })
      .rpc()

    const configAccount = await program.account.config.fetch(configPda)
    assert.equal(
      configAccount.treasuryAuthority.toBase58(),
      nextTreasuryAuthority.publicKey.toBase58()
    )

    treasuryTokenAccount = nextTreasuryTokenAccount
  })

  async function createMarket(label) {
    const marketId = `${label}-${Date.now()}-${Math.round(Math.random() * 1e6)}`
    const marketIdHash = hash32(`market:${marketId}`)
    const [marketPda] = SolanaPublicKey.findProgramAddressSync(
      [Buffer.from(MARKET_SEED), marketIdHash],
      program.programId
    )
    const [vaultPda] = SolanaPublicKey.findProgramAddressSync(
      [Buffer.from(VAULT_SEED), marketPda.toBuffer()],
      program.programId
    )
    const now = unixTimestamp()
    const schedule = {
      opensAt: now - 5,
      joinDeadlineAt: now + 10,
      decisionCutoffAt: now + 10,
      closesAt: now + 12,
      resolvesAt: now + 13,
    }

    await program.methods
      .createMarket(
        [...marketIdHash],
        new BN(schedule.opensAt),
        new BN(schedule.joinDeadlineAt),
        new BN(schedule.decisionCutoffAt),
        new BN(schedule.closesAt),
        new BN(schedule.resolvesAt)
      )
      .accounts({
        config: configPda,
        market: marketPda,
        settlementMint,
        vault: vaultPda,
        authority: payer.publicKey,
        adminAuthority: payer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc()

    return {
      marketId,
      marketIdHash,
      marketPda,
      vaultPda,
      schedule,
    }
  }

  async function createParticipant(mintAmount) {
    const keypair = Keypair.generate()
    await airdrop(keypair.publicKey)

    const tokenAccount = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        payer,
        settlementMint,
        keypair.publicKey
      )
    ).address

    await mintTo(
      provider.connection,
      payer,
      settlementMint,
      tokenAccount,
      payer,
      mintAmount
    )

    return {
      keypair,
      tokenAccount,
    }
  }

  async function commitAgentDecision(
    marketPda,
    agentAuthority,
    side,
    agentLabel
  ) {
    const [agentCommitmentPda] = SolanaPublicKey.findProgramAddressSync(
      [
        Buffer.from(AGENT_COMMITMENT_SEED),
        marketPda.toBuffer(),
        agentAuthority.publicKey.toBuffer(),
      ],
      program.programId
    )

    await program.methods
      .commitAgentDecision(
        [...hash32(`agent:${agentLabel}`)],
        [...hash32(`snapshot:${agentLabel}`)],
        [...hash32(`prompt:${agentLabel}`)],
        [...hash32(`config:${agentLabel}`)],
        [...hash32(`reason:${agentLabel}`)],
        toAnchorSide(side)
      )
      .accounts({
        config: configPda,
        market: marketPda,
        agentCommitment: agentCommitmentPda,
        agentAuthority: agentAuthority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([agentAuthority])
      .rpc()

    return agentCommitmentPda
  }

  async function openPosition(
    marketPda,
    vaultPda,
    agentCommitmentPda,
    participant,
    stakeAmount
  ) {
    const [positionPda] = SolanaPublicKey.findProgramAddressSync(
      [
        Buffer.from(POSITION_SEED),
        marketPda.toBuffer(),
        participant.keypair.publicKey.toBuffer(),
        agentCommitmentPda.toBuffer(),
      ],
      program.programId
    )

    await program.methods
      .openPosition(new BN(stakeAmount.toString()))
      .accounts({
        config: configPda,
        market: marketPda,
        agentCommitment: agentCommitmentPda,
        position: positionPda,
        user: participant.keypair.publicKey,
        userTokenAccount: participant.tokenAccount,
        settlementMint,
        vault: vaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([participant.keypair])
      .rpc()

    return positionPda
  }

  async function resolveWhenReady(marketPda, outcome) {
    const deadline = Date.now() + 30_000

    while (true) {
      try {
        await program.methods
          .resolveMarket(toAnchorSide(outcome))
          .accounts({
            config: configPda,
            market: marketPda,
            oracleAuthority: oracleAuthority.publicKey,
          })
          .signers([oracleAuthority])
          .rpc()
        return
      } catch (error) {
        if (!isMarketNotClosedError(error) || Date.now() >= deadline) {
          throw error
        }

        await sleep(1_000)
      }
    }
  }

  async function claimPayout(marketPda, vaultPda, positionPda, participant) {
    await program.methods
      .claimPayout()
      .accounts({
        config: configPda,
        market: marketPda,
        position: positionPda,
        user: participant.keypair.publicKey,
        userTokenAccount: participant.tokenAccount,
        treasuryTokenAccount,
        settlementMint,
        vault: vaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([participant.keypair])
      .rpc()
  }

  async function airdrop(publicKey, lamports = 2 * LAMPORTS_PER_SOL) {
    const signature = await provider.connection.requestAirdrop(publicKey, lamports)
    const latestBlockhash = await provider.connection.getLatestBlockhash()

    await provider.connection.confirmTransaction(
      {
        signature,
        ...latestBlockhash,
      },
      "confirmed"
    )
  }

  async function pauseProgram() {
    await program.methods
      .pause()
      .accounts({
        config: configPda,
        adminAuthority: payer.publicKey,
      })
      .rpc()
  }

  async function ensureProgramUnpaused() {
    const configAccount = await program.account.config.fetch(configPda)

    if (!configAccount.paused) {
      return
    }

    await program.methods
      .unpause()
      .accounts({
        config: configPda,
        adminAuthority: payer.publicKey,
      })
      .rpc()
  }

  async function expectAnchorError(action, expectedPatterns) {
    let thrown = null

    try {
      await action()
    } catch (error) {
      thrown = error
    }

    assert.ok(thrown, "expected action to fail")

    const message = thrown instanceof Error ? thrown.message : String(thrown)
    assert.ok(
      expectedPatterns.some((pattern) => message.includes(pattern)),
      `expected error message to include one of: ${expectedPatterns.join(", ")}\nreceived: ${message}`
    )
  }
})

function hash32(value) {
  return createHash("sha256").update(value).digest()
}

function unixTimestamp() {
  return Math.floor(Date.now() / 1_000)
}

function toAnchorSide(side) {
  return side === "yes" ? { yes: {} } : { no: {} }
}

function readEnumVariant(value) {
  if (!value || typeof value !== "object") {
    return String(value)
  }

  const [variant] = Object.keys(value)
  return variant ?? ""
}

function readU64(value) {
  if (typeof value === "bigint") {
    return value
  }

  if (typeof value === "number") {
    return BigInt(value)
  }

  if (typeof value === "string") {
    return BigInt(value)
  }

  if (value && typeof value === "object" && "toString" in value) {
    return BigInt(value.toString())
  }

  throw new Error(`Unable to normalize u64 value: ${String(value)}`)
}

function isMarketNotClosedError(error) {
  const message = error instanceof Error ? error.message : String(error)
  return (
    message.includes("MarketNotClosed") ||
    message.includes("Market is not closed yet")
  )
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
