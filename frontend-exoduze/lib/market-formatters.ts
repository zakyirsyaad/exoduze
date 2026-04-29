import type { MarketStatus } from "@/hooks/Type"
import moment from "moment"

import { parseApiMoment } from "@/lib/time-formatters"

const liquidityFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

export const parseApiDate = (value?: string | null) => {
  return parseApiMoment(value)?.toDate() ?? null
}

export const formatMarketLiquidity = (value: string) => {
  const numericValue = Number(value)

  if (!Number.isFinite(numericValue)) {
    return value
  }

  return `$${liquidityFormatter.format(numericValue)}`
}

export const formatMarketStatusLabel = (status: MarketStatus) => {
  return status.charAt(0).toUpperCase() + status.slice(1)
}

export const formatMarketEndsIn = (value: string) => {
  const targetTime = parseApiMoment(value)

  if (!targetTime) {
    return "TBD"
  }

  const diffMs = targetTime.diff(moment())

  if (diffMs <= 0) {
    return "Ended"
  }

  const duration = moment.duration(diffMs)
  const totalHours = Math.floor(duration.asHours())
  const days = Math.floor(totalHours / 24)
  const hours = totalHours % 24
  const minutes = duration.minutes()

  if (days > 0) {
    return `${days}d ${hours}h`
  }

  return `${hours}h ${minutes}m`
}

export const formatSlugLabel = (value: string) =>
  value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
