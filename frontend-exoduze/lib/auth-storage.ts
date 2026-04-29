import type { AuthSession } from "@/lib/auth-client"

export const AUTH_TOKEN_STORAGE_KEY = "access_token"
export const AUTH_SESSION_STORAGE_KEY = "auth_session"

const canUseStorage = () =>
  typeof window !== "undefined" && !!window.localStorage

export function getStoredAccessToken() {
  if (!canUseStorage()) {
    return null
  }

  return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)
}

export function getStoredAuthSession() {
  if (!canUseStorage()) {
    return null
  }

  const storedSession = window.localStorage.getItem(AUTH_SESSION_STORAGE_KEY)

  if (!storedSession) {
    return null
  }

  try {
    return JSON.parse(storedSession) as AuthSession
  } catch {
    return null
  }
}

export function setStoredAuthSession(session: AuthSession) {
  if (!canUseStorage()) {
    return
  }

  window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, session.access_token)
  window.localStorage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(session))
}

export function clearStoredAuthSession() {
  if (!canUseStorage()) {
    return
  }

  window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY)
  window.localStorage.removeItem(AUTH_SESSION_STORAGE_KEY)
}
