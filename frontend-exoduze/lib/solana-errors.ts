const GENERIC_TRANSACTION_PLAN_MESSAGE =
  "The provided transaction plan failed to execute"

const UNKNOWN_SOLANA_TRANSACTION_MESSAGE =
  "Solana transaction failed. Check your wallet, token balance, RPC cluster, and on-chain market configuration."
const ANCHOR_ERROR_MESSAGE_PATTERN = /Error Message:\s*([^.]*(?:\.[^.]*)?)/i

type PlanStatus = "failed" | "canceled"

export function normalizeSolanaTransactionError(
  error: unknown,
  fallbackMessage: string
) {
  const message =
    getSolanaTransactionErrorMessage(error) ??
    getErrorMessage(error) ??
    fallbackMessage

  if (error instanceof Error && error.message === message) {
    return error
  }

  const normalizedError = new Error(message)
  normalizedError.name = error instanceof Error ? error.name : "Error"

  return normalizedError
}

export function serializeSolanaTransactionError(error: unknown) {
  const message = getErrorMessage(error)
  const detail =
    getSolanaTransactionErrorMessage(error) ?? getErrorDetail(error)
  const logs = getStringArray(findNestedValue(error, "logs"))?.slice(-5)
  const serializedError = stringifyCompact(error)
  const summary = {
    abortReason:
      stringifyCompact(getProperty(error, "abortReason")) ?? undefined,
    causeMessage:
      getStringValue(findNestedValue(error, "causeMessage")) ?? undefined,
    code: getCodeValue(error),
    constructorName: getConstructorName(error),
    detail: detail ?? undefined,
    logs,
    message: message ?? undefined,
    name: getStringValue(getProperty(error, "name")) ?? undefined,
    ownKeys: getOwnPropertyNames(error),
    rpcError: stringifyCompact(findNestedValue(error, "err")) ?? undefined,
    serializedError:
      serializedError && serializedError !== "{}" ? serializedError : undefined,
    stackPreview: getStackPreview(error),
    type: getErrorType(error),
  }

  return Object.fromEntries(
    Object.entries(summary).filter(([, value]) => {
      if (value === undefined || value === null) {
        return false
      }

      if (Array.isArray(value)) {
        return value.length > 0
      }

      return true
    })
  )
}

export function getSolanaTransactionErrorMessage(error: unknown) {
  const transactionPlanResult = findNestedValue(error, "transactionPlanResult")

  if (transactionPlanResult) {
    const failedPlan = findPlanByStatus(transactionPlanResult, "failed")

    if (failedPlan) {
      const failedError = getProperty(failedPlan, "error")
      const detail =
        getErrorDetail(failedError) ??
        getErrorDetail(failedPlan) ??
        UNKNOWN_SOLANA_TRANSACTION_MESSAGE

      return withSolanaPrefix(detail)
    }

    const canceledPlan = findPlanByStatus(transactionPlanResult, "canceled")

    if (canceledPlan) {
      return "Solana transaction was canceled before it finished."
    }

    return UNKNOWN_SOLANA_TRANSACTION_MESSAGE
  }

  const detail = getErrorDetail(error)

  if (detail && looksLikeSolanaError(error)) {
    return withSolanaPrefix(detail)
  }

  const message = getErrorMessage(error)

  if (message?.includes(GENERIC_TRANSACTION_PLAN_MESSAGE)) {
    return UNKNOWN_SOLANA_TRANSACTION_MESSAGE
  }

  return null
}

function getErrorDetail(
  error: unknown,
  seen = new WeakSet<object>()
): string | null {
  if (!error) {
    return null
  }

  if (isObjectLike(error)) {
    if (seen.has(error)) {
      return null
    }

    seen.add(error)
  }

  const logs = getStringArray(findNestedValue(error, "logs"))
  const logDetail = logs ? getRelevantLogLine(logs) : null

  if (logDetail) {
    return logDetail
  }

  const causeMessage = getStringValue(findNestedValue(error, "causeMessage"))

  if (causeMessage && !isGenericTransactionPlanMessage(causeMessage)) {
    return trimForUi(causeMessage)
  }

  const cause = getProperty(error, "cause")
  const causeDetail: string | null = cause ? getErrorDetail(cause, seen) : null

  if (causeDetail) {
    return causeDetail
  }

  const abortReason = getProperty(error, "abortReason")
  const abortReasonDetail: string | null = abortReason
    ? (getErrorDetail(abortReason, seen) ?? stringifyCompact(abortReason))
    : null

  if (abortReasonDetail) {
    return trimForUi(abortReasonDetail)
  }

  const rpcError = findNestedValue(error, "err")
  const rpcErrorDetail = rpcError ? stringifyCompact(rpcError) : null

  if (rpcErrorDetail) {
    return trimForUi(rpcErrorDetail)
  }

  const message = getErrorMessage(error)

  if (message && !isGenericTransactionPlanMessage(message)) {
    return trimForUi(message)
  }

  return null
}

function findPlanByStatus(
  planResult: unknown,
  status: PlanStatus,
  seen = new WeakSet<object>()
): unknown {
  if (!isObjectLike(planResult)) {
    return null
  }

  if (seen.has(planResult)) {
    return null
  }

  seen.add(planResult)

  if (
    getProperty(planResult, "kind") === "single" &&
    getProperty(planResult, "status") === status
  ) {
    return planResult
  }

  const plans = getProperty(planResult, "plans")

  if (Array.isArray(plans)) {
    for (const plan of plans) {
      const match = findPlanByStatus(plan, status, seen)

      if (match) {
        return match
      }
    }
  }

  return null
}

function findNestedValue(
  value: unknown,
  key: string,
  depth = 6,
  seen = new WeakSet<object>()
): unknown {
  if (!isObjectLike(value) || depth <= 0) {
    return undefined
  }

  if (seen.has(value)) {
    return undefined
  }

  seen.add(value)

  const directValue = getProperty(value, key)

  if (directValue !== undefined) {
    return directValue
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const nestedValue = findNestedValue(item, key, depth - 1, seen)

      if (nestedValue !== undefined) {
        return nestedValue
      }
    }

    return undefined
  }

  const nestedKeys = [
    "context",
    "cause",
    "error",
    "errors",
    "failedTransactions",
    "abortReason",
    "preflightData",
    "data",
    "result",
    "value",
  ]

  for (const nestedKey of nestedKeys) {
    const nestedValue = getProperty(value, nestedKey)
    const match = findNestedValue(nestedValue, key, depth - 1, seen)

    if (match !== undefined) {
      return match
    }
  }

  return undefined
}

function getRelevantLogLine(logs: readonly string[]) {
  const anchorMessageLog = [...logs]
    .reverse()
    .find((log) => ANCHOR_ERROR_MESSAGE_PATTERN.test(log))

  if (anchorMessageLog) {
    const match = anchorMessageLog.match(ANCHOR_ERROR_MESSAGE_PATTERN)

    if (match?.[1]) {
      return trimForUi(match[1])
    }
  }

  const interestingLog = [...logs].reverse().find((log) =>
    /anchorerror|custom program error|insufficient|failed|error|panic|invalid|missing|not found/i.test(
      log
    )
  )

  const logLine = interestingLog ?? logs.at(-1)

  if (!logLine) {
    return null
  }

  return trimForUi(logLine.replace(/^Program log:\s*/i, ""))
}

function looksLikeSolanaError(error: unknown) {
  const message = getErrorMessage(error)

  return Boolean(
    message?.toLowerCase().includes("solana") ||
    message?.toLowerCase().includes("transaction") ||
    message?.toLowerCase().includes("program") ||
    findNestedValue(error, "logs") ||
    findNestedValue(error, "causeMessage") ||
    findNestedValue(error, "err")
  )
}

function withSolanaPrefix(detail: string) {
  if (detail.toLowerCase().startsWith("solana transaction")) {
    return detail
  }

  return `Solana transaction failed: ${detail}`
}

function isGenericTransactionPlanMessage(message: string) {
  return message.includes(GENERIC_TRANSACTION_PLAN_MESSAGE)
}

function getStringArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : null
}

function getStringValue(value: unknown) {
  return typeof value === "string" ? value : null
}

function getCodeValue(error: unknown) {
  const code = getProperty(error, "code")

  if (
    typeof code === "string" ||
    typeof code === "number" ||
    typeof code === "bigint"
  ) {
    return code.toString()
  }

  return undefined
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === "string") {
    return error
  }

  return null
}

function getOwnPropertyNames(error: unknown) {
  if (!isObjectLike(error)) {
    return []
  }

  try {
    return Object.getOwnPropertyNames(error)
  } catch {
    return []
  }
}

function getConstructorName(error: unknown) {
  if (!isObjectLike(error)) {
    return undefined
  }

  const constructor = getProperty(error, "constructor")
  const name = getStringValue(getProperty(constructor, "name"))

  return name ?? undefined
}

function getErrorType(error: unknown) {
  if (error === null) {
    return "null"
  }

  if (Array.isArray(error)) {
    return "array"
  }

  if (isObjectLike(error)) {
    return getConstructorName(error) ?? typeof error
  }

  return typeof error
}

function getStackPreview(error: unknown) {
  if (!(error instanceof Error) || !error.stack) {
    return undefined
  }

  const preview = error.stack
    .split("\n")
    .slice(0, 4)
    .map((line) => line.trim())
    .join(" | ")

  return preview ? trimForUi(preview) : undefined
}

function getProperty(value: unknown, key: string) {
  if (!isObjectLike(value) || !(key in value)) {
    return undefined
  }

  try {
    return Reflect.get(value, key)
  } catch {
    return undefined
  }
}

function isObjectLike(value: unknown): value is object {
  return (typeof value === "object" || typeof value === "function") && !!value
}

function stringifyCompact(value: unknown) {
  if (typeof value === "string") {
    return value
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return value.toString()
  }

  try {
    return JSON.stringify(value, (_key, nestedValue) =>
      typeof nestedValue === "bigint" ? nestedValue.toString() : nestedValue
    )
  } catch {
    return null
  }
}

function trimForUi(value: string) {
  const normalizedValue = value.replace(/\s+/g, " ").trim()

  return normalizedValue.length > 260
    ? `${normalizedValue.slice(0, 257)}...`
    : normalizedValue
}
