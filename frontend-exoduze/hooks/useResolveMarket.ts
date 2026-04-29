"use client"

import * as React from "react"
import { useSendTransaction, useWallet } from "@solana/react-hooks"

import {
  buildResolveMarketInstruction,
  type ExoduzeTransactionResult,
  type ResolveMarketInput,
} from "@/lib/exoduze-program"
import { normalizeSolanaTransactionError } from "@/lib/solana-errors"

type ResolveMarketStatus = "idle" | "pending" | "success" | "error"

export function useResolveMarket() {
  const wallet = useWallet()
  const sender = useSendTransaction()
  const [status, setStatus] = React.useState<ResolveMarketStatus>("idle")
  const [error, setError] = React.useState<Error | null>(null)
  const [data, setData] = React.useState<ExoduzeTransactionResult | null>(null)

  const submit = React.useCallback(
    async (input: ResolveMarketInput) => {
      try {
        setStatus("pending")
        setError(null)
        setData(null)

        if (wallet.status !== "connected") {
          throw new Error("Connect your wallet before resolving this market.")
        }

        const oracleAuthority =
          input.oracleAuthority ?? wallet.session.account.address.toString()
        const instruction = buildResolveMarketInstruction({
          ...input,
          oracleAuthority,
        })
        const signature = await sender.send(
          {
            authority: wallet.session,
            feePayer: wallet.session.account.address,
            instructions: [instruction],
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
          "Unable to resolve market"
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
    data,
    error,
    loading: status === "pending",
    reset,
    resolveMarket: submit,
    status,
  }
}
