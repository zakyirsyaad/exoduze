import moment, { type Moment } from "moment"

const DISPLAY_TIMEZONE_OFFSET_MINUTES = 7 * 60
const DISPLAY_TIMEZONE_LABEL = "WIB"
const DISPLAY_DATE_LOCALE = "en-US"

export const DEFAULT_BROWSER_TIME_ZONE = "UTC"

const normalizeApiDateValue = (value: string) =>
  value
    .trim()
    .replace(/\s+/g, " ")
    .replace(" ", "T")
    .replace(/([+-]\d{2})(\d{2})$/, "$1:$2")
    .replace(/([+-]\d{2})$/, "$1:00")

const buildApiDateCandidates = (value: string) => {
  const normalizedValue = normalizeApiDateValue(value)
  const sanitizedValue = normalizedValue.replace(/[.,;]+$/, "")

  return sanitizedValue === normalizedValue
    ? [normalizedValue]
    : [normalizedValue, sanitizedValue]
}

export const parseApiMoment = (value?: string | null): Moment | null => {
  if (!value) {
    return null
  }

  for (const candidate of buildApiDateCandidates(value)) {
    const strictParsedDate = moment.parseZone(candidate, moment.ISO_8601, true)

    if (strictParsedDate.isValid()) {
      return strictParsedDate
    }

    const looseParsedDate = moment.parseZone(candidate)

    if (looseParsedDate.isValid()) {
      return looseParsedDate
    }

    const parsedTimestamp = Date.parse(candidate)

    if (Number.isFinite(parsedTimestamp)) {
      return moment.parseZone(new Date(parsedTimestamp).toISOString())
    }
  }

  return null
}

const toDisplayMoment = (value?: string | null) => {
  return parseApiMoment(value)
    ?.clone()
    .utcOffset(DISPLAY_TIMEZONE_OFFSET_MINUTES)
}

export const getApiDateTimestamp = (value?: string | null) => {
  const parsedDate = parseApiMoment(value)

  return parsedDate ? parsedDate.valueOf() : null
}

export const getApiDateIsoString = (value?: string | null) => {
  const parsedDate = parseApiMoment(value)

  return parsedDate ? parsedDate.toISOString() : null
}

type TimeZoneFormatOptions = {
  fallback?: string
  timeZone?: string
}

const formatInTimeZone = (
  value: string | null | undefined,
  formatterOptions: Intl.DateTimeFormatOptions,
  {
    fallback = "TBD",
    timeZone = DEFAULT_BROWSER_TIME_ZONE,
  }: TimeZoneFormatOptions = {}
) => {
  const timestamp = getApiDateTimestamp(value)

  if (timestamp === null) {
    return fallback
  }

  return new Intl.DateTimeFormat(DISPLAY_DATE_LOCALE, {
    ...formatterOptions,
    timeZone,
  }).format(timestamp)
}

export const formatDateTimeForTimeZone = (
  value?: string | null,
  options?: TimeZoneFormatOptions
) =>
  formatInTimeZone(
    value,
    {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZoneName: "short",
    },
    options
  )

export const formatClockTimeForTimeZone = (
  value?: string | null,
  options?: TimeZoneFormatOptions
) =>
  formatInTimeZone(
    value,
    {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    },
    options
  )

export const formatDisplayDateTime = (
  value?: string | null,
  fallback = "TBD"
) => {
  const parsedDate = toDisplayMoment(value)

  if (!parsedDate) {
    return fallback
  }

  return `${parsedDate.format("MMM D, YYYY, h:mm A")} ${DISPLAY_TIMEZONE_LABEL}`
}

export const formatDisplayClockTime = (
  value?: string | null,
  fallback = "TBD"
) => {
  const parsedDate = toDisplayMoment(value)

  if (!parsedDate) {
    return fallback
  }

  return parsedDate.format("HH:mm")
}

export const formatRelativeTime = (value?: string | null, fallback = "TBD") => {
  const parsedDate = parseApiMoment(value)

  if (!parsedDate) {
    return fallback
  }

  return parsedDate.fromNow()
}

export const formatCountdown = (
  value?: string | null,
  fallback = "00:00:00"
) => {
  const targetDate = parseApiMoment(value)

  if (!targetDate) {
    return fallback
  }

  const remainingSeconds = Math.max(0, targetDate.diff(moment(), "seconds"))
  const duration = moment.duration(remainingSeconds, "seconds")
  const hours = Math.floor(duration.asHours())
  const minutes = duration.minutes()
  const seconds = duration.seconds()

  return [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, "0"))
    .join(":")
}

export const isApiDateSameOrBeforeNow = (value?: string | null) => {
  const parsedDate = parseApiMoment(value)

  return parsedDate ? parsedDate.isSameOrBefore(moment()) : false
}
