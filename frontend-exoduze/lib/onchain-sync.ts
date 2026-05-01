import { ApiError } from "@/lib/api"

export type OnchainSyncRefs = {
  agentCommitmentPubkey?: string
  positionPubkey?: string
  signature?: string
  userTokenAccount?: string
  vaultPubkey?: string
}

type SyncOnchainTransactionWithRetryOptions = {
  context: string
  onRetry?: (detail: {
    attempt: number
    error: unknown
    retryInMs: number
    totalAttempts: number
  }) => void
  refs: OnchainSyncRefs
  sync: (refs: OnchainSyncRefs) => Promise<void>
}

const ONCHAIN_SYNC_RETRY_DELAYS_MS = [1_500, 3_000, 5_000]
const RETRYABLE_SYNC_MESSAGE_PATTERNS = [
  "no successful on-chain transaction was found",
  "no successful onchain transaction was found",
  "no confirmed on-chain stake state was found",
  "transaction was found for this position yet",
  "transaction not found",
  "tx not found",
  "position yet",
  "not visible on-chain yet",
] as const
const AMBIGUOUS_TRANSACTION_SUBMISSION_MESSAGE_PATTERNS = [
  "the wallet did not return",
  "the provided transaction plan failed to execute",
  "solana transaction failed. check your wallet, token balance, rpc cluster, and on-chain market configuration.",
  "something went wrong while processing the request",
  "unable to stake and join",
  "unable to open position",
] as const

export async function syncOnchainTransactionWithRetry({
  context,
  onRetry,
  refs,
  sync,
}: SyncOnchainTransactionWithRetryOptions) {
  const totalAttempts = ONCHAIN_SYNC_RETRY_DELAYS_MS.length + 1

  for (let attemptIndex = 0; attemptIndex < totalAttempts; attemptIndex += 1) {
    try {
      await sync(refs)

      if (attemptIndex > 0) {
        console.info(`[${context}] on-chain sync recovered`, {
          attempt: attemptIndex + 1,
          refs,
        })
      }

      return
    } catch (error) {
      const nextAttempt = attemptIndex + 2
      const retryInMs = ONCHAIN_SYNC_RETRY_DELAYS_MS[attemptIndex]
      const shouldRetry =
        retryInMs !== undefined && isPendingOnchainSyncError(error)

      if (!shouldRetry) {
        throw attachTransactionRefs(error, refs)
      }

      console.warn(`[${context}] on-chain sync not visible yet`, {
        attempt: attemptIndex + 1,
        nextAttempt,
        refs,
        retryInMs,
      })

      onRetry?.({
        attempt: nextAttempt,
        error,
        retryInMs,
        totalAttempts,
      })

      await wait(retryInMs)
    }
  }
}

export function isPendingOnchainSyncError(error: unknown) {
  const message = getErrorMessage(error)?.toLowerCase()

  if (!message) {
    return false
  }

  const hasRetryableMessage = RETRYABLE_SYNC_MESSAGE_PATTERNS.some((pattern) =>
    message.includes(pattern)
  )

  if (!hasRetryableMessage) {
    return false
  }

  if (!(error instanceof ApiError)) {
    return true
  }

  return [404, 409, 422, 425, 429, 500, 502, 503, 504].includes(error.status)
}

export function isAmbiguousTransactionSubmissionError(error: unknown) {
  if (error instanceof ApiError) {
    return false
  }

  const message = getErrorMessage(error)?.toLowerCase()

  if (!message) {
    return true
  }

  return AMBIGUOUS_TRANSACTION_SUBMISSION_MESSAGE_PATTERNS.some((pattern) =>
    message.includes(pattern)
  )
}

export function formatOnchainSyncRefs(refs?: OnchainSyncRefs | null) {
  if (!refs) {
    return null
  }

  const parts = [
    refs.signature ? `tx ${truncateRef(refs.signature)}` : null,
    refs.positionPubkey ? `position ${truncateRef(refs.positionPubkey)}` : null,
    refs.agentCommitmentPubkey
      ? `commitment ${truncateRef(refs.agentCommitmentPubkey)}`
      : null,
  ].filter(Boolean)

  return parts.length ? parts.join(", ") : null
}

export function attachTransactionRefs(error: unknown, refs: OnchainSyncRefs) {
  const fallbackMessage = getErrorMessage(error) ?? "On-chain transaction failed."
  const baseError =
    error instanceof Error ? error : new Error(fallbackMessage)

  const transactionRefs = {
    ...getExistingTransactionRefs(baseError),
    ...refs,
  }

  try {
    return Object.assign(baseError, { transactionRefs })
  } catch {
    const wrappedError = new Error(baseError.message || fallbackMessage)
    wrappedError.name = baseError.name || "Error"

    return Object.assign(wrappedError, { transactionRefs })
  }
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return typeof error === "string" ? error : null
}

function getExistingTransactionRefs(error: unknown) {
  if (!error || typeof error !== "object" || !("transactionRefs" in error)) {
    return {}
  }

  const refs = (error as { transactionRefs?: unknown }).transactionRefs

  return refs && typeof refs === "object" ? refs : {}
}

function truncateRef(value: string) {
  return value.length <= 12
    ? value
    : `${value.slice(0, 6)}...${value.slice(-6)}`
}

function wait(durationMs: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, durationMs)
  })
}
