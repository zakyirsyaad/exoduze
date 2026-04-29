"use client"

import * as React from "react"
import { startTransition } from "react"
import { useRouter } from "next/navigation"

import {
  MARKET_DETAIL_REFRESH_EVENT,
  type MarketDetailRefreshEventDetail,
} from "@/lib/market-events"

type MarketLiveSyncProps = {
  marketIdOrSlug: string
}

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? process.env.NEXT_PUBLIC_URL
const RECONNECT_DELAY_MS = 3_000
const MIN_REFRESH_INTERVAL_MS = 1_500

export function MarketLiveSync({ marketIdOrSlug }: MarketLiveSyncProps) {
  const router = useRouter()
  const lastRevisionRef = React.useRef<string | null>(null)
  const lastRefreshAtRef = React.useRef(0)

  React.useEffect(() => {
    if (!API_BASE_URL) {
      return
    }

    let disposed = false
    let socket: WebSocket | null = null
    let reconnectTimeoutId: number | null = null

    const triggerRefresh = () => {
      const now = Date.now()

      if (now - lastRefreshAtRef.current < MIN_REFRESH_INTERVAL_MS) {
        return
      }

      lastRefreshAtRef.current = now
      const detail: MarketDetailRefreshEventDetail = { marketIdOrSlug }

      window.dispatchEvent(
        new CustomEvent<MarketDetailRefreshEventDetail>(
          MARKET_DETAIL_REFRESH_EVENT,
          { detail }
        )
      )

      startTransition(() => {
        router.refresh()
      })
    }

    const scheduleReconnect = () => {
      if (disposed || reconnectTimeoutId !== null) {
        return
      }

      reconnectTimeoutId = window.setTimeout(() => {
        reconnectTimeoutId = null
        connect()
      }, RECONNECT_DELAY_MS)
    }

    const connect = () => {
      if (disposed) {
        return
      }

      const wsUrl = buildMarketLiveWebSocketUrl(API_BASE_URL, marketIdOrSlug)

      if (!wsUrl) {
        return
      }

      socket = new WebSocket(wsUrl)

      socket.onmessage = (event) => {
        const payload = parseSocketPayload(event.data)

        if (!payload || typeof payload.type !== "string") {
          return
        }

        if (payload.type === "market.ready" && typeof payload.revision === "string") {
          lastRevisionRef.current = payload.revision
          return
        }

        if (
          payload.type === "market.updated" &&
          typeof payload.revision === "string"
        ) {
          if (payload.revision === lastRevisionRef.current) {
            return
          }

          lastRevisionRef.current = payload.revision
          triggerRefresh()
        }
      }

      socket.onclose = () => {
        socket = null
        scheduleReconnect()
      }

      socket.onerror = () => {
        socket?.close()
      }
    }

    connect()

    return () => {
      disposed = true
      if (reconnectTimeoutId !== null) {
        window.clearTimeout(reconnectTimeoutId)
      }
      socket?.close()
    }
  }, [marketIdOrSlug, router])

  return null
}

function buildMarketLiveWebSocketUrl(
  baseUrl: string,
  marketIdOrSlug: string
) {
  try {
    const url = new URL(
      `/v1/markets/${encodeURIComponent(marketIdOrSlug)}/live`,
      baseUrl
    )

    url.protocol = url.protocol === "https:" ? "wss:" : "ws:"

    return url.toString()
  } catch {
    return null
  }
}

function parseSocketPayload(value: unknown) {
  if (typeof value !== "string") {
    return null
  }

  try {
    return JSON.parse(value) as {
      type?: string
      revision?: string
    }
  } catch {
    return null
  }
}
