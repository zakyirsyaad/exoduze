import * as anchor from "@coral-xyz/anchor"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const rootDir = resolve(new URL("..", import.meta.url).pathname)
const rpcUrl = process.env.ANCHOR_PROVIDER_URL ?? "https://api.devnet.solana.com"
const walletPath =
  process.env.ANCHOR_WALLET ?? "/home/zkyxentertain/.config/solana/phantom.json"
const oracleAuthority =
  process.env.EXODUZE_ORACLE_AUTHORITY ??
  "ExG9yviVVNeTBUcdjQ64hLhm5rmiQsr3iusiNc8Xzbmn"
const treasuryAuthority =
  process.env.EXODUZE_TREASURY_AUTHORITY ??
  "HynCU9tq6jug7p7ASimcT2rJK8nvVbmwcSvGX6E2rMBS"
const feeBps = Number.parseInt(process.env.EXODUZE_FEE_BPS ?? "100", 10)
const idl = JSON.parse(
  readFileSync(resolve(rootDir, "idl/exoduze_prediction_market.json"), "utf8")
)
const secret = JSON.parse(readFileSync(walletPath, "utf8"))
const wallet = new anchor.Wallet(
  anchor.web3.Keypair.fromSecretKey(Uint8Array.from(secret))
)
const connection = new anchor.web3.Connection(rpcUrl, "confirmed")
const provider = new anchor.AnchorProvider(connection, wallet, {
  commitment: "confirmed",
})
const program = new anchor.Program(idl, provider)
const [configPda] = anchor.web3.PublicKey.findProgramAddressSync(
  [Buffer.from("config")],
  program.programId
)

if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10_000) {
  throw new Error("EXODUZE_FEE_BPS must be an integer between 0 and 10000.")
}

const existing = await connection.getAccountInfo(configPda, "confirmed")

if (!existing) {
  const signature = await program.methods
    .initializeConfig(
      new anchor.web3.PublicKey(oracleAuthority),
      new anchor.web3.PublicKey(treasuryAuthority),
      feeBps
    )
    .accounts({
      config: configPda,
      admin: wallet.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc()

  console.log(`Initialized config: ${signature}`)
}

const config = await program.account.config.fetch(configPda)
console.log(
  JSON.stringify(
    {
      program_id: program.programId.toBase58(),
      config_pubkey: configPda.toBase58(),
      admin_authority: config.adminAuthority.toBase58(),
      oracle_authority: config.oracleAuthority.toBase58(),
      treasury_authority: config.treasuryAuthority.toBase58(),
      fee_bps: config.feeBps,
      paused: config.paused,
    },
    null,
    2
  )
)
