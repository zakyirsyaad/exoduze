"use client"

import * as React from "react"
import { useSendTransaction, useWallet } from "@solana/react-hooks"

import {
  buildOpenPositionInstructions,
  type ExoduzeTransactionResult,
  type OpenPositionInput,
} from "@/lib/exoduze-program"
import {
  normalizeSolanaTransactionError,
  serializeSolanaTransactionError,
} from "@/lib/solana-errors"
import { attachTransactionRefs } from "@/lib/onchain-sync"

type OpenPositionStatus = "idle" | "pending" | "success" | "error"

export function useOpenPosition() {
  const wallet = useWallet()
  const sender = useSendTransaction()
  const [status, setStatus] = React.useState<OpenPositionStatus>("idle")
  const [error, setError] = React.useState<Error | null>(null)
  const [data, setData] = React.useState<ExoduzeTransactionResult | null>(null)

  const submit = React.useCallback(
    async (input: OpenPositionInput) => {
      let transactionRefs: Partial<ExoduzeTransactionResult> | null = null

      try {
        setStatus("pending")
        setError(null)
        setData(null)

        if (wallet.status !== "connected") {
          throw new Error("Connect your wallet before opening a position.")
        }

        const connectedAddress = wallet.session.account.address.toString()

        if (connectedAddress !== input.walletAddress) {
          throw new Error(
            "Connected wallet does not match the authenticated wallet."
          )
        }

        const bundle = await buildOpenPositionInstructions(input)
        transactionRefs = {
          agentCommitmentPubkey: bundle.agentCommitmentPubkey,
          positionPubkey: bundle.positionPubkey,
          userTokenAccount: bundle.userTokenAccount,
          vaultPubkey: bundle.vaultPubkey,
        }
        const signature = await sender.send(
          {
            authority: wallet.session,
            feePayer: wallet.session.account.address,
            instructions: bundle.instructions,
          },
          { commitment: "processed" }
        )
        const result = {
          agentCommitmentPubkey: bundle.agentCommitmentPubkey,
          positionPubkey: bundle.positionPubkey,
          signature: signature.toString(),
          userTokenAccount: bundle.userTokenAccount,
          vaultPubkey: bundle.vaultPubkey,
        }

        setData(result)
        setStatus("success")
        return result
      } catch (err) {
        const nextError = normalizeSolanaTransactionError(
          err,
          "Unable to open position"
        )
        const walletConnector =
          wallet.status === "connected" ? wallet.session.connector : null

        console.error("[stake] open position transaction failed", {
          connectorId: walletConnector?.id ?? null,
          connectorKind: walletConnector?.kind ?? null,
          connectorName: walletConnector?.name ?? null,
          normalizedErrorMessage: nextError.message,
          normalizedErrorName: nextError.name,
          errorSummary: serializeSolanaTransactionError(err),
          transactionRefs,
        })
        const errorWithRefs = transactionRefs
          ? attachTransactionRefs(nextError, transactionRefs)
          : nextError

        setError(errorWithRefs)
        setStatus("error")
        throw errorWithRefs
      }
    },
    [sender, wallet]
  )

  const reset = React.useCallback(() => {
    setStatus("idle")
    setError(null)
    setData(null)
  }, [])

  return {
    data,
    error,
    loading: status === "pending",
    openPosition: submit,
    reset,
    status,
  }
}
