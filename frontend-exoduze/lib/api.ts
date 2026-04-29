import { getStoredAccessToken } from "@/lib/auth-storage"

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? process.env.NEXT_PUBLIC_URL ?? ""

type ApiFetchOptions = RequestInit & {
  auth?: boolean
  authToken?: string | null
}

export class ApiError extends Error {
  status: number
  payload: unknown

  constructor(status: number, payload: unknown, message?: string) {
    super(message ?? `Request failed: ${status}`)
    this.name = "ApiError"
    this.status = status
    this.payload = payload
  }
}

export function getApiUrl(endpoint: string) {
  if (/^https?:\/\//i.test(endpoint)) {
    return endpoint
  }

  if (!API_BASE_URL) {
    return endpoint
  }

  const normalizedEndpoint = endpoint.startsWith("/")
    ? endpoint
    : `/${endpoint}`
  return `${API_BASE_URL}${normalizedEndpoint}`
}

const shouldSetJsonContentType = (body: BodyInit | null | undefined) => {
  if (!body) {
    return false
  }

  return typeof FormData === "undefined" || !(body instanceof FormData)
}

export async function apiFetch<T>(
  endpoint: string,
  options: ApiFetchOptions = {}
): Promise<T> {
  const { auth = true, authToken, headers, ...fetchOptions } = options
  const requestHeaders = new Headers(headers)
  const token = authToken ?? (auth ? getStoredAccessToken() : null)

  if (
    shouldSetJsonContentType(fetchOptions.body) &&
    !requestHeaders.has("Content-Type")
  ) {
    requestHeaders.set("Content-Type", "application/json")
  }

  if (token && !requestHeaders.has("Authorization")) {
    requestHeaders.set("Authorization", `Bearer ${token}`)
  }

  const response = await fetch(getApiUrl(endpoint), {
    ...fetchOptions,
    headers: requestHeaders,
  })

  if (response.status === 204) {
    return null as T
  }

  const responseText = await response.text()
  const payload = responseText ? parseJson(responseText) : null

  if (!response.ok) {
    throw new ApiError(response.status, payload, getErrorMessage(payload))
  }

  return payload as T
}

function getErrorMessage(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return undefined
  }

  const message = getStringValue((payload as ErrorPayload).message)
  const code = getStringValue((payload as ErrorPayload).code)
  const error = (payload as ErrorPayload).error

  if (message) {
    return message
  }

  if (typeof error === "string") {
    return error
  }

  if (error && typeof error === "object") {
    const nestedError = error as ErrorPayload

    return (
      getStringValue(nestedError.message) ??
      getStringValue(nestedError.code) ??
      code
    )
  }

  return code
}

type ErrorPayload = {
  code?: unknown
  error?: unknown
  message?: unknown
}

function getStringValue(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function parseJson(value: string) {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}
