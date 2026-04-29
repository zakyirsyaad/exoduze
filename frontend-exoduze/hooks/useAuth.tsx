"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react"
import type { ReactNode } from "react"

import {
  authenticateWithWallet,
  fetchCurrentAuthSession,
  isSessionExpired,
  logoutAuthSession,
  type AuthSession,
  type SolanaAuthWallet,
} from "@/lib/auth-client"
import {
  clearStoredAuthSession,
  getStoredAccessToken,
  getStoredAuthSession,
  setStoredAuthSession,
} from "@/lib/auth-storage"

type AuthContextValue = {
  session: AuthSession | null
  loading: boolean
  error: string | null
  isAuthenticated: boolean
  isAdmin: boolean
  loginWithWallet: (wallet: SolanaAuthWallet) => Promise<AuthSession>
  logout: () => Promise<void>
  refreshSession: () => Promise<AuthSession | null>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refreshSession = useCallback(async () => {
    const token = getStoredAccessToken()
    const storedSession = getStoredAuthSession()

    if (!token || (storedSession && isSessionExpired(storedSession))) {
      clearStoredAuthSession()
      setSession(null)
      setLoading(false)
      return null
    }

    try {
      setLoading(true)
      setError(null)
      const currentSession = await fetchCurrentAuthSession(token)
      setStoredAuthSession(currentSession)
      setSession(currentSession)
      return currentSession
    } catch (err) {
      clearStoredAuthSession()
      setSession(null)
      setError(err instanceof Error ? err.message : "Unable to verify session")
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const loginWithWallet = useCallback(async (wallet: SolanaAuthWallet) => {
    try {
      setLoading(true)
      setError(null)
      const nextSession = await authenticateWithWallet(wallet)
      setStoredAuthSession(nextSession)
      setSession(nextSession)
      return nextSession
    } catch (err) {
      clearStoredAuthSession()
      setSession(null)
      const message =
        err instanceof Error ? err.message : "Unable to authenticate wallet"
      setError(message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  const logout = useCallback(async () => {
    const token = getStoredAccessToken()

    try {
      setLoading(true)
      setError(null)

      if (token) {
        await logoutAuthSession(token)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to logout")
    } finally {
      clearStoredAuthSession()
      setSession(null)
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void refreshSession()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [refreshSession])

  const isAdmin =
    !!session?.permissions.full_access ||
    session?.roles.includes("admin") ||
    false

  return (
    <AuthContext.Provider
      value={{
        session,
        loading,
        error,
        isAuthenticated: !!session,
        isAdmin,
        loginWithWallet,
        logout,
        refreshSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const auth = useContext(AuthContext)

  if (!auth) {
    throw new Error("useAuth must be used within AuthProvider")
  }

  return auth
}
