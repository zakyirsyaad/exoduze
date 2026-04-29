"use client"

import type { WalletConnector, WalletSession } from "@solana/client"
import {
  address,
  signature as solanaSignature,
  type SendableTransaction,
  type Signature,
  type Transaction,
} from "@solana/kit"
import {
  getTransactionDecoder,
  getTransactionEncoder,
} from "@solana/transactions"
import { PublicKey, VersionedTransaction } from "@solana/web3.js"

type PhantomPublicKey = {
  toBase58?: () => string
  toBytes?: () => Uint8Array
  toString: () => string
}

type PhantomConnectResponse = {
  publicKey?: PhantomPublicKey
}

type PhantomSignMessageResponse = {
  signature?: Uint8Array
}

type PhantomSignAndSendResponse = {
  signature?: string
}

type PhantomProvider = {
  isPhantom?: boolean
  publicKey?: PhantomPublicKey | null
  connect: (options?: {
    onlyIfTrusted?: boolean
  }) => Promise<PhantomConnectResponse>
  disconnect?: () => Promise<void>
  signAndSendTransaction?: (
    transaction: VersionedTransaction,
    options?: { preflightCommitment?: string }
  ) => Promise<PhantomSignAndSendResponse | string>
  signMessage?: (
    message: Uint8Array,
    display?: "hex" | "utf8"
  ) => Promise<PhantomSignMessageResponse | Uint8Array>
  signTransaction?: (
    transaction: VersionedTransaction
  ) => Promise<VersionedTransaction>
}

const metadata = {
  canAutoConnect: true,
  id: "phantom:legacy",
  kind: "injected",
  name: "Phantom",
  ready: typeof window !== "undefined",
} as const

const transactionEncoder = getTransactionEncoder()
const transactionDecoder = getTransactionDecoder()

export function createPhantomLegacyConnector(): WalletConnector {
  return {
    ...metadata,
    async connect(options) {
      const provider = getPhantomProvider()

      if (!provider) {
        throw new Error("Phantom wallet extension is not available.")
      }

      const response = await provider.connect({
        onlyIfTrusted: options?.autoConnect === true,
      })
      const publicKey = response.publicKey ?? provider.publicKey

      if (!publicKey) {
        throw new Error("Phantom did not return a wallet address.")
      }

      return createPhantomSession(provider, publicKey)
    },
    async disconnect() {
      await getPhantomProvider()?.disconnect?.()
    },
    isSupported() {
      return Boolean(getPhantomProvider())
    },
  }
}

function createPhantomSession(
  provider: PhantomProvider,
  publicKey: PhantomPublicKey
): WalletSession {
  return {
    account: {
      address: address(getPublicKeyString(publicKey)),
      publicKey: getPublicKeyBytes(publicKey),
    },
    connector: metadata,
    async disconnect() {
      await provider.disconnect?.()
    },
    sendTransaction: provider.signAndSendTransaction
      ? async (transaction, config) => {
          const web3Transaction = toVersionedTransaction(transaction)
          const result = await provider.signAndSendTransaction?.(
            web3Transaction,
            { preflightCommitment: config?.commitment }
          )
          const transactionSignature =
            typeof result === "string" ? result : result?.signature

          if (!transactionSignature) {
            throw new Error("Phantom did not return a transaction signature.")
          }

          return solanaSignature(transactionSignature) as Signature
        }
      : undefined,
    signMessage: provider.signMessage
      ? async (message) => {
          const result = await provider.signMessage?.(message, "utf8")
          const signatureBytes =
            result instanceof Uint8Array ? result : result?.signature

          if (!signatureBytes) {
            throw new Error("Phantom did not return a message signature.")
          }

          return signatureBytes
        }
      : undefined,
    signTransaction: provider.signTransaction
      ? async (transaction) => {
          const signedTransaction = await provider.signTransaction?.(
            toVersionedTransaction(transaction)
          )

          if (!signedTransaction) {
            throw new Error("Phantom did not return a signed transaction.")
          }

          return transactionDecoder.decode(
            signedTransaction.serialize()
          ) as SendableTransaction & Transaction
        }
      : undefined,
  }
}

function getPhantomProvider() {
  if (typeof window === "undefined") {
    return null
  }

  const globalWindow = window as Window & {
    phantom?: { solana?: PhantomProvider }
    solana?: PhantomProvider
  }
  const provider = globalWindow.phantom?.solana ?? globalWindow.solana

  return provider?.isPhantom ? provider : null
}

function getPublicKeyString(publicKey: PhantomPublicKey) {
  return publicKey.toBase58?.() ?? publicKey.toString()
}

function getPublicKeyBytes(publicKey: PhantomPublicKey) {
  return (
    publicKey.toBytes?.() ??
    new PublicKey(getPublicKeyString(publicKey)).toBytes()
  )
}

function toVersionedTransaction(
  transaction: SendableTransaction & Transaction
) {
  return VersionedTransaction.deserialize(
    new Uint8Array(transactionEncoder.encode(transaction))
  )
}
