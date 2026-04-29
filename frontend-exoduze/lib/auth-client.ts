import type { WalletSession } from "@solana/client"

import { apiFetch } from "@/lib/api"
import { getStoredAuthSession } from "@/lib/auth-storage"

type ApiResponse<T> = {
  data: T
}

export type AuthChallenge = {
  challenge_id: string
  message: string
  expires_at: string
}

export type AuthWallet = {
  wallet_address: string
  wallet_identity_id: string
}

export type AuthPermissions = Record<string, boolean | undefined> & {
  full_access?: boolean
  manage_agents?: boolean
}

export type AuthSession = {
  access_token: string
  token_type: "Bearer" | string
  expires_at: string
  wallet: AuthWallet
  roles: string[]
  permissions: AuthPermissions
}

type AuthSessionPayload = Partial<AuthSession> & {
  wallet_address?: string
  wallet_identity_id?: string
}

type VerifyAuthChallengeInput = {
  challenge_id: string
  wallet_address: string
  signature: string
}

export type SolanaAuthWallet = Pick<WalletSession, "account" | "signMessage">

export async function requestAuthChallenge(walletAddress: string) {
  const response = await apiFetch<ApiResponse<AuthChallenge>>(
    "/v1/auth/challenge",
    {
      method: "POST",
      auth: false,
      body: JSON.stringify({ wallet_address: walletAddress }),
    }
  )

  return response.data
}

export async function verifyAuthChallenge(input: VerifyAuthChallengeInput) {
  const response = await apiFetch<ApiResponse<AuthSessionPayload>>(
    "/v1/auth/verify",
    {
      method: "POST",
      auth: false,
      body: JSON.stringify(input),
    }
  )

  return normalizeAuthSession(response.data)
}

export async function fetchCurrentAuthSession(token: string) {
  const storedSession = getStoredAuthSession()
  const response = await apiFetch<ApiResponse<AuthSessionPayload>>(
    "/v1/auth/me",
    {
      method: "GET",
      authToken: token,
    }
  )

  return normalizeAuthSession(response.data, token, storedSession)
}

export async function logoutAuthSession(token: string) {
  await apiFetch<unknown>("/v1/auth/logout", {
    method: "POST",
    authToken: token,
  })
}

export async function authenticateWithWallet(wallet: SolanaAuthWallet) {
  if (!wallet.signMessage) {
    throw new Error("Selected wallet does not support message signing")
  }

  const walletAddress = wallet.account.address.toString()
  const challenge = await requestAuthChallenge(walletAddress)
  const message = new TextEncoder().encode(challenge.message)
  const signatureBytes = await wallet.signMessage(message)

  return verifyAuthChallenge({
    challenge_id: challenge.challenge_id,
    wallet_address: walletAddress,
    signature: bytesToBase58(signatureBytes),
  })
}

export function isSessionExpired(session: AuthSession) {
  const expiresAt = Date.parse(session.expires_at)

  return Number.isFinite(expiresAt) && expiresAt <= Date.now()
}

function normalizeAuthSession(
  payload: AuthSessionPayload,
  fallbackToken?: string,
  fallbackSession?: AuthSession | null
): AuthSession {
  const accessToken =
    payload.access_token ?? fallbackToken ?? fallbackSession?.access_token
  const wallet =
    payload.wallet ??
    fallbackSession?.wallet ??
    (payload.wallet_address
      ? {
          wallet_address: payload.wallet_address,
          wallet_identity_id: payload.wallet_identity_id ?? "",
        }
      : null)

  if (!accessToken) {
    throw new Error("Auth response did not include an access token")
  }

  if (!wallet?.wallet_address) {
    throw new Error("Auth response did not include wallet identity")
  }

  return {
    access_token: accessToken,
    token_type: payload.token_type ?? fallbackSession?.token_type ?? "Bearer",
    expires_at: payload.expires_at ?? fallbackSession?.expires_at ?? "",
    wallet,
    roles: payload.roles ?? fallbackSession?.roles ?? [],
    permissions: payload.permissions ?? fallbackSession?.permissions ?? {},
  }
}

function bytesToBase58(bytes: Uint8Array) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
  const digits = [0]

  for (const byte of bytes) {
    let carry = byte

    for (let index = 0; index < digits.length; index += 1) {
      carry += digits[index] * 256
      digits[index] = carry % 58
      carry = Math.floor(carry / 58)
    }

    while (carry > 0) {
      digits.push(carry % 58)
      carry = Math.floor(carry / 58)
    }
  }

  let encoded = ""

  for (const byte of bytes) {
    if (byte !== 0) {
      break
    }

    encoded += alphabet[0]
  }

  for (let index = digits.length - 1; index >= 0; index -= 1) {
    encoded += alphabet[digits[index]]
  }

  return encoded
}
