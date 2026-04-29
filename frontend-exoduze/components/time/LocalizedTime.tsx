"use client"

import {
  formatClockTimeForTimeZone,
  formatDateTimeForTimeZone,
  getApiDateIsoString,
} from "@/lib/time-formatters"

import { useUserTimeZone } from "./UserTimeZoneProvider"

type LocalizedTimeTextProps = {
  className?: string
  fallback?: string
  value?: string | null
}

export function LocalizedDateTimeText({
  className,
  fallback = "TBD",
  value,
}: LocalizedTimeTextProps) {
  const timeZone = useUserTimeZone()
  const isoDate = getApiDateIsoString(value)

  return (
    <time
      className={className}
      dateTime={isoDate ?? undefined}
      suppressHydrationWarning
    >
      {formatDateTimeForTimeZone(value, { fallback, timeZone })}
    </time>
  )
}

export function LocalizedClockTimeText({
  className,
  fallback = "TBD",
  value,
}: LocalizedTimeTextProps) {
  const timeZone = useUserTimeZone()
  const isoDate = getApiDateIsoString(value)

  return (
    <time
      className={className}
      dateTime={isoDate ?? undefined}
      suppressHydrationWarning
    >
      {formatClockTimeForTimeZone(value, { fallback, timeZone })}
    </time>
  )
}
