"use client"

import * as React from "react"
import { useSendTransaction, useWallet } from "@solana/react-hooks"

import {
  buildCommitAgentDecisionInstruction,
  type CommitAgentDecisionInput,
  type ExoduzeTransactionResult,
} from "@/lib/exoduze-program"
import { normalizeSolanaTransactionError } from "@/lib/solana-errors"

type CommitAgentDecisionStatus = "idle" | "pending" | "success" | "error"

export function useCommitAgentDecision() {
  const wallet = useWallet()
  const sender = useSendTransaction()
  const [status, setStatus] = React.useState<CommitAgentDecisionStatus>("idle")
  const [error, setError] = React.useState<Error | null>(null)
  const [data, setData] = React.useState<ExoduzeTransactionResult | null>(null)

  const submit = React.useCallback(
    async (input: CommitAgentDecisionInput) => {
      try {
        setStatus("pending")
        setError(null)
        setData(null)

        if (wallet.status !== "connected") {
          throw new Error("Connect your wallet before committing a decision.")
        }

        const connectedAddress = wallet.session.account.address.toString()

        if (connectedAddress !== input.agentAuthority) {
          throw new Error(
            "Connected wallet does not match the agent authority."
          )
        }

        const instruction = await buildCommitAgentDecisionInstruction(input)
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
          "Unable to commit agent decision"
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
    commitAgentDecision: submit,
    data,
    error,
    loading: status === "pending",
    reset,
    status,
  }
}
