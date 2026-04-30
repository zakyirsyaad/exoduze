"use client"

import * as React from "react"
import { useWallet } from "@solana/react-hooks"

import { PayoutBreakdown } from "@/components/markets/PayoutBreakdown"
import { TopAgentBonusBadge } from "@/components/markets/TopAgentBonusBadge"
import { useUserTimeZone } from "@/components/time/UserTimeZoneProvider"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useAuth } from "@/hooks/useAuth"
import type { MarketDetailResponse, MarketUserContext } from "@/hooks/Type"
import { apiFetch } from "@/lib/api"
import {
  MARKET_DETAIL_REFRESH_EVENT,
  type MarketDetailRefreshEventDetail,
} from "@/lib/market-events"
import { formatDateTimeForTimeZone } from "@/lib/time-formatters"

type MarketWalletContextProps = {
  slug: string
}

const currencyFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

export function MarketWalletContext({ slug }: MarketWalletContextProps) {
  const auth = useAuth()
  const wallet = useWallet()
  const timeZone = useUserTimeZone()
  const [marketDetail, setMarketDetail] =
    React.useState<MarketDetailResponse | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const connectedAddress =
    wallet.status === "connected"
      ? wallet.session.account.address.toString()
      : null
  const authenticatedWallet = auth.session?.wallet.wallet_address ?? null

  const loadWalletContext = React.useCallback(async () => {
    if (!authenticatedWallet) {
      setMarketDetail(null)
      setError(null)
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      setError(null)
      const response = await apiFetch<MarketDetailResponse>(
        `/v1/markets/${encodeURIComponent(slug)}?wallet=${encodeURIComponent(
          authenticatedWallet
        )}`
      )
      setMarketDetail(response)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to load wallet market context"
      )
    } finally {
      setLoading(false)
    }
  }, [authenticatedWallet, slug])

  React.useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadWalletContext()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [loadWalletContext])

  React.useEffect(() => {
    const handleMarketRefresh = (event: Event) => {
      const detail = (event as CustomEvent<MarketDetailRefreshEventDetail>)
        .detail

      if (!detail?.marketIdOrSlug || detail.marketIdOrSlug === slug) {
        void loadWalletContext()
      }
    }

    window.addEventListener(MARKET_DETAIL_REFRESH_EVENT, handleMarketRefresh)

    return () => {
      window.removeEventListener(
        MARKET_DETAIL_REFRESH_EVENT,
        handleMarketRefresh
      )
    }
  }, [loadWalletContext, slug])

  if (auth.loading) {
    return (
      <WalletContextCard
        description="Checking wallet session..."
        title="Your Market Activity"
      />
    )
  }

  if (!authenticatedWallet) {
    return (
      <WalletContextCard
        description={
          connectedAddress
            ? "Sign in with your wallet to load your positions and payouts."
            : "Connect and sign your wallet to load your positions and payouts."
        }
        title={connectedAddress ? "Wallet Connected" : "Your Market Activity"}
      />
    )
  }

  if (loading && !marketDetail) {
    return (
      <WalletContextCard
        description="Loading positions and payouts..."
        title="Your Market Activity"
      />
    )
  }

  if (error && !marketDetail) {
    return (
      <WalletContextCard
        description="We could not load wallet activity right now."
        title="Your Market Activity"
        tone="error"
      />
    )
  }

  const context = getUserContext(marketDetail, authenticatedWallet)
  const agentNameById = new Map(
    (marketDetail?.data.agents ?? []).map((marketAgent) => [
      marketAgent.agent.id,
      marketAgent.agent.name,
    ])
  )
  const agentNameByMarketAgentId = new Map(
    (marketDetail?.data.agents ?? []).map((marketAgent) => [
      marketAgent.market_agent_id,
      marketAgent.agent.name,
    ])
  )

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Your Market Activity</CardTitle>
            <CardDescription>
              Positions and payouts for this wallet.
            </CardDescription>
          </div>
          <Badge variant="outline" className="rounded">
            {truncateAddress(context.wallet_address)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-5 text-sm">
        <section className="grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <p className="font-medium">Positions</p>
            <Badge variant="secondary" className="rounded">
              {context.positions.length}
            </Badge>
          </div>
          {context.positions.length ? (
            context.positions.map((position) => (
              <article
                key={position.position_id}
                className="rounded-md border border-black/10 p-3 dark:border-white/10"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">
                        {agentNameById.get(position.agent_id) ?? "AI Agent"}
                      </p>
                      {position.top_bonus_eligible ? (
                        <TopAgentBonusBadge />
                      ) : null}
                    </div>
                    <p className="text-neutral-500">
                      Opened{" "}
                      {formatDateTimeForTimeZone(position.opened_at, {
                        timeZone,
                      })}
                    </p>
                  </div>
                  <Badge variant="outline" className="rounded">
                    {formatTextLabel(position.status)}
                  </Badge>
                </div>
                <p className="mt-3 font-medium">
                  {formatCurrency(position.stake_usdc)}
                </p>
              </article>
            ))
          ) : (
            <p className="text-neutral-500">
              No positions for this wallet yet.
            </p>
          )}
        </section>

        <section className="grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <p className="font-medium">Payouts</p>
            <Badge variant="secondary" className="rounded">
              {context.payouts.length}
            </Badge>
          </div>
          {context.payouts.length ? (
            context.payouts.map((payout) => (
              <article
                key={payout.payout_id}
                className="rounded-md border border-black/10 p-3 dark:border-white/10"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">
                        {agentNameByMarketAgentId.get(payout.market_agent_id) ??
                          "AI Agent"}
                      </p>
                      {payout.top_bonus_eligible ? (
                        <TopAgentBonusBadge />
                      ) : null}
                    </div>
                    <p className="text-neutral-500">
                      {payout.paid_at
                        ? `Paid ${formatDateTimeForTimeZone(payout.paid_at, {
                            timeZone,
                          })}`
                        : "Payout pending"}
                    </p>
                  </div>
                  <Badge variant="outline" className="rounded">
                    {formatTextLabel(payout.status)}
                  </Badge>
                </div>
                <div className="mt-3 space-y-1">
                  <p className="text-[11px] uppercase tracking-normal text-neutral-500">
                    Claimable total
                  </p>
                  <p className="font-medium">
                    {formatCurrency(payout.breakdown?.net_usdc ?? payout.net_usdc)}
                  </p>
                </div>
                {payout.breakdown ? (
                  <PayoutBreakdown breakdown={payout.breakdown} />
                ) : null}
              </article>
            ))
          ) : (
            <p className="text-neutral-500">No payouts for this wallet yet.</p>
          )}
        </section>
      </CardContent>
    </Card>
  )
}

function WalletContextCard({
  description,
  title,
  tone = "default",
}: {
  description: string
  title: string
  tone?: "default" | "error"
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription
          className={tone === "error" ? "text-destructive" : undefined}
        >
          {description}
        </CardDescription>
      </CardHeader>
    </Card>
  )
}

function getUserContext(
  marketDetail: MarketDetailResponse | null,
  walletAddress: string
): MarketUserContext {
  return (
    marketDetail?.data.user_context ?? {
      wallet_address: walletAddress,
      positions: [],
      payouts: [],
    }
  )
}

function truncateAddress(address: string) {
  return `${address.slice(0, 4)}...${address.slice(-4)}`
}

function formatCurrency(value?: string | null) {
  const numericValue = Number(value ?? "0")

  if (!Number.isFinite(numericValue)) {
    return "0 USDC"
  }

  return `${currencyFormatter.format(numericValue)} USDC`
}

function formatTextLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}
