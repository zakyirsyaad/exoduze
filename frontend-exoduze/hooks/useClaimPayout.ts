"use client"

import * as React from "react"
import { useSendTransaction, useWallet } from "@solana/react-hooks"

import {
  buildClaimPayoutInstructions,
  type ClaimPayoutInput,
  type ExoduzeTransactionResult,
} from "@/lib/exoduze-program"
import { normalizeSolanaTransactionError } from "@/lib/solana-errors"

type ClaimPayoutStatus = "idle" | "pending" | "success" | "error"

export function useClaimPayout() {
  const wallet = useWallet()
  const sender = useSendTransaction()
  const [status, setStatus] = React.useState<ClaimPayoutStatus>("idle")
  const [error, setError] = React.useState<Error | null>(null)
  const [data, setData] = React.useState<ExoduzeTransactionResult | null>(null)

  const submit = React.useCallback(
    async (input: ClaimPayoutInput) => {
      try {
        setStatus("pending")
        setError(null)
        setData(null)

        if (wallet.status !== "connected") {
          throw new Error("Connect your wallet before claiming a payout.")
        }

        const connectedAddress = wallet.session.account.address.toString()

        if (connectedAddress !== input.walletAddress) {
          throw new Error("Connected wallet does not match the payout wallet.")
        }

        const bundle = buildClaimPayoutInstructions(input)
        const signature = await sender.send(
          {
            authority: wallet.session,
            feePayer: wallet.session.account.address,
            instructions: bundle.instructions,
          },
          { commitment: "confirmed" }
        )
        const result = { signature: signature.toString() }

        setData(result)
        setStatus("success")
        return result
      } catch (err) {
        const nextError = normalizeSolanaTransactionError(
          err,
          "Unable to claim payout"
        )
        setError(nextError)
        setStatus("error")
        throw nextError
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
    claimPayout: submit,
    data,
    error,
    loading: status === "pending",
    reset,
    status,
  }
}
