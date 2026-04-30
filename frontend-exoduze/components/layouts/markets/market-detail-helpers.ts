import type { MarketStatus } from "@/hooks/Type"
import { formatDisplayDateTime } from "@/lib/time-formatters"

const currencyFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

const percentageFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

export const formatStatusLabel = (status: MarketStatus) =>
  status.charAt(0).toUpperCase() + status.slice(1)

export const formatCurrency = (value?: string | null, asset = "USDC") => {
  const numericValue = Number(value ?? "0")

  if (!Number.isFinite(numericValue)) {
    return asset
  }

  return `${currencyFormatter.format(numericValue)} ${asset}`
}

export const formatAccuracyPct = (value?: string | null) => {
  if (value == null) {
    return "N/A"
  }

  const numericValue = Number(value ?? "0")

  if (!Number.isFinite(numericValue)) {
    return value ?? "N/A"
  }

  return `${percentageFormatter.format(numericValue)}%`
}

export const formatCurrentStreak = (value?: number | null) => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "N/A"
  }

  return `${value} wins`
}

export const formatConfidence = (value?: number | null) => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "N/A"
  }

  return `${Math.round(value * 100)}%`
}

export const formatProbability = (value?: number | null) => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "N/A"
  }

  return `${percentageFormatter.format(value)}%`
}

export const formatDateTime = formatDisplayDateTime

export const formatTextLabel = (value?: string | null) =>
  (value ?? "pending")
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")

export const formatWallet = (value?: string | null) =>
  value ? `${value.slice(0, 4)}...${value.slice(-4)}` : "Not assigned"

export const formatActorIdentity = ({
  actor,
  wallet,
}: {
  actor?: string | null
  wallet?: string | null
}) => {
  const formattedWallet = wallet ? formatWallet(wallet) : null

  if (actor && formattedWallet) {
    return `${actor} (${formattedWallet})`
  }

  if (actor) {
    return actor
  }

  if (formattedWallet) {
    return formattedWallet
  }

  return "Not assigned"
}

export const formatContextValue = (value: unknown) => {
  if (value === null || value === undefined) {
    return "N/A"
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value)
  }

  return JSON.stringify(value)
}

export const getDecisionBadgeClass = (side?: string | null) => {
  if (side === "YES") {
    return "bg-emerald-600 text-white hover:bg-emerald-600"
  }

  if (side === "NO") {
    return "bg-rose-600 text-white hover:bg-rose-600"
  }

  return ""
}
