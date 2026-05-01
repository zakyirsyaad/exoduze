"use client"

import {
  defaultWalletConnectors,
  type SolanaClientConfig,
} from "@solana/client"
import { SolanaProvider } from "@solana/react-hooks"

import { createPhantomLegacyConnector } from "@/lib/phantom-legacy-connector"

const DEVNET_RPC_URL = "https://api.devnet.solana.com"
const DEVNET_WS_URL = "wss://api.devnet.solana.com"

const solanaLogger: NonNullable<SolanaClientConfig["logger"]> = ({
  data,
  level,
  message,
}) => {
  if (
    message === "wallet connection failed" ||
    message === "account subscription failed"
  ) {
    console.warn(`[react-core] ${message}`, data ?? {})
    return
  }

  const payload = data ?? {}

  if (level === "error") {
    console.error(`[react-core] ${message}`, payload)
    return
  }

  if (level === "warn") {
    console.warn(`[react-core] ${message}`, payload)
    return
  }

  if (level === "info") {
    console.info(`[react-core] ${message}`, payload)
  }
}

const defaultConfig: SolanaClientConfig = {
  cluster: "devnet",
  logger: solanaLogger,
  rpc: process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? DEVNET_RPC_URL,
  websocket: process.env.NEXT_PUBLIC_SOLANA_WS_URL ?? DEVNET_WS_URL,
  walletConnectors: [
    ...defaultWalletConnectors(),
    createPhantomLegacyConnector(),
  ],
}

export default function Providers({ children }: { children: React.ReactNode }) {
  return <SolanaProvider config={defaultConfig}>{children}</SolanaProvider>
}
