"use client"

import * as React from "react"
import Link from "next/link"
import { HugeiconsIcon } from "@hugeicons/react"
import { RefreshIcon, Wallet01Icon } from "@hugeicons/core-free-icons"
import { useWallet } from "@solana/react-hooks"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { PortfolioPayout, PortfolioResponse } from "@/hooks/Type"
import { useAuth } from "@/hooks/useAuth"
import { useClaimPayout } from "@/hooks/useClaimPayout"
import { apiFetch } from "@/lib/api"
import {
  getExoduzeProgramConfig,
  isValidSolanaPublicKey,
} from "@/lib/exoduze-program"
import { formatDisplayDateTime } from "@/lib/time-formatters"
import { ScrollArea } from "@/components/ui/scroll-area"

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 6,
})

const currencyFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

export default function PortfolioPage() {
  const auth = useAuth()
  const wallet = useWallet()
  const claimPayout = useClaimPayout()
  const [portfolio, setPortfolio] = React.useState<PortfolioResponse | null>(
    null
  )
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [claimingPayoutId, setClaimingPayoutId] = React.useState<string | null>(
    null
  )

  const walletAddress = auth.session?.wallet.wallet_address ?? null
  const connectedWallet =
    wallet.status === "connected"
      ? wallet.session.account.address.toString()
      : null
  const claimConfiguration = React.useMemo(() => getClaimConfiguration(), [])

  const loadPortfolio = React.useCallback(async () => {
    if (!walletAddress) {
      setPortfolio(null)
      setError(null)
      return
    }

    try {
      setLoading(true)
      setError(null)
      const response = await apiFetch<PortfolioResponse>(
        `/v1/portfolio/${encodeURIComponent(walletAddress)}`
      )
      setPortfolio(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load portfolio")
    } finally {
      setLoading(false)
    }
  }, [walletAddress])

  React.useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadPortfolio()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [loadPortfolio])

  const handleClaim = React.useCallback(
    async (payout: PortfolioPayout) => {
      if (!walletAddress) {
        return
      }

      const disabledReason = getClaimDisabledReason(
        payout,
        walletAddress,
        claimConfiguration
      )
      if (disabledReason) {
        toast.error(disabledReason)
        return
      }

      try {
        const marketPubkey = payout.market.onchain_market_pubkey
        const positionRef = payout.onchain_position_ref
        const readyClaimConfiguration = claimConfiguration.ready
          ? claimConfiguration
          : null

        if (!readyClaimConfiguration) {
          toast.error(claimConfiguration.reason)
          return
        }

        if (!marketPubkey || !positionRef) {
          toast.error("This payout is missing its on-chain claim references.")
          return
        }

        setClaimingPayoutId(payout.id)
        const result = await claimPayout.claimPayout({
          walletAddress,
          marketPubkey,
          positionRef,
          treasuryTokenAccount: readyClaimConfiguration.treasuryTokenAccount,
          settlementMint: readyClaimConfiguration.settlementMint,
        })

        const updated = await apiFetch<PortfolioResponse>(
          `/v1/portfolio/${encodeURIComponent(
            walletAddress
          )}/payouts/${encodeURIComponent(payout.id)}/claim`,
          {
            method: "POST",
            body: JSON.stringify({ tx_sig: result.signature }),
          }
        )
        setPortfolio(updated)
        toast.success("Payout claim submitted")
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Unable to claim payout")
      } finally {
        setClaimingPayoutId(null)
      }
    },
    [claimConfiguration, claimPayout, walletAddress]
  )

  if (auth.loading) {
    return <PortfolioShell title="Portfolio" description="Checking wallet session..." />
  }

  if (!walletAddress) {
    return (
      <PortfolioShell
        title={connectedWallet ? "Sign in to view portfolio" : "Connect wallet"}
        description="Your portfolio is private to your wallet session."
      />
    )
  }

  const data = portfolio?.data

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-5 pb-16">
      <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm text-neutral-500">Wallet Portfolio</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-normal">
            Assets and market activity
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-neutral-500">
            Review wallet balances, AI battles owned by your agents, user
            positions, and claimable payouts.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => void loadPortfolio()}
          disabled={loading}
        >
          <HugeiconsIcon icon={RefreshIcon} />
          Refresh
        </Button>
      </section>

      {error ? (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle>Unable to load portfolio</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <section className="grid gap-4 md:grid-cols-3">
        <BalanceCard
          label="SOL Balance"
          value={formatToken(data?.balances.sol.ui_amount_string, "SOL")}
        />
        <BalanceCard
          label="USDC Balance"
          value={formatToken(data?.balances.usdc.ui_amount_string, "USDC")}
        />
        <Card>
          <CardHeader>
            <CardTitle>Wallet</CardTitle>
            <CardDescription className="break-all">
              {walletAddress}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Badge variant="secondary" className="rounded">
              {connectedWallet === walletAddress ? "Connected" : "Signed in"}
            </Badge>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_0.9fr] h-[500px]">
        <Card>
          <CardHeader>
            <CardTitle>User Participant</CardTitle>
            <CardDescription>
              Markets where this wallet opened a position.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <ScrollArea className="h-[500px] pr-3 pb-20">
              {data?.user_participants.length ? (
                data.user_participants.map((item) => (
                  <article
                    key={item.position.id}
                    className="rounded-md border border-black/10 p-4 dark:border-white/10"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <Link
                          href={`/markets/${item.market.slug}`}
                          className="font-medium hover:underline"
                        >
                          {item.market.title}
                        </Link>
                        <p className="mt-1 text-sm text-neutral-500">
                          Following {item.agent.name}
                        </p>
                      </div>
                      <Badge variant="outline" className="rounded">
                        {formatLabel(item.position.status)}
                      </Badge>
                    </div>
                    <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
                      <Metric label="Stake" value={formatUsdc(item.position.stake_usdc)} />
                      <Metric
                        label="Decision"
                        value={item.agent.final_decision_side ?? "Pending"}
                      />
                      <Metric
                        label="Payout"
                        value={
                          item.payout?.net_usdc
                            ? formatUsdc(item.payout.net_usdc)
                            : "Not available"
                        }
                      />
                    </div>
                  </article>
                ))
              ) : (
                <EmptyState text="No user positions yet." />
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>AI Join Battle</CardTitle>
            <CardDescription>
              Markets joined by AI agents owned by this wallet.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <ScrollArea className="h-[500px] pr-3 pb-20">
              {data?.ai_battles.length ? (
                data.ai_battles.map((item) => (
                  <article
                    key={item.market_agent_id}
                    className="rounded-md border border-black/10 p-4 dark:border-white/10"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <Link
                          href={`/markets/${item.market.slug}`}
                          className="font-medium hover:underline"
                        >
                          {item.agent.name}
                        </Link>
                        <p className="mt-1 text-sm text-neutral-500">
                          {item.market.title}
                        </p>
                      </div>
                      <Badge variant="secondary" className="rounded">
                        {formatLabel(item.status)}
                      </Badge>
                    </div>
                    <div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
                      <Metric
                        label="Final Decision"
                        value={item.final_decision_side ?? "Pending"}
                      />
                      <Metric
                        label="Follower Stake"
                        value={formatUsdc(item.follower_staked_usdc)}
                      />
                    </div>
                  </article>
                ))
              ) : (
                <EmptyState text="No owned AI agents have joined a market yet." />
              )}
            </ScrollArea>

          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Manual Claims</CardTitle>
          <CardDescription>
            Claimable payouts require a wallet-signed transaction.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {!claimConfiguration.ready ? (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-300">
              {claimConfiguration.reason}
            </p>
          ) : null}
          <ScrollArea className="h-[500px] pr-3 pb-20">

            {data?.payouts.length ? (
              data.payouts.map((payout) => {
                const disabledReason = getClaimDisabledReason(
                  payout,
                  walletAddress,
                  claimConfiguration
                )
                const canClaim = payout.status === "claimable" && !disabledReason

                return (
                  <article
                    key={payout.id}
                    className="flex flex-col gap-4 rounded-md border border-black/10 p-4 md:flex-row md:items-center md:justify-between dark:border-white/10"
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/markets/${payout.market.slug}`}
                          className="font-medium hover:underline"
                        >
                          {payout.market.title}
                        </Link>
                        <Badge variant="outline" className="rounded">
                          {formatLabel(payout.status)}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-neutral-500">
                        {payout.agent.name}
                        {payout.paid_at
                          ? ` - paid ${formatDisplayDateTime(payout.paid_at)}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <p className="text-sm font-medium">
                        {formatUsdc(payout.net_usdc)}
                      </p>
                      <Button
                        type="button"
                        disabled={!canClaim || claimingPayoutId === payout.id}
                        onClick={() => void handleClaim(payout)}
                      >
                        <HugeiconsIcon icon={Wallet01Icon} />
                        {claimingPayoutId === payout.id ? "Claiming" : "Claim"}
                      </Button>
                    </div>
                    {disabledReason && payout.status === "claimable" ? (
                      <p className="text-xs text-neutral-500 md:max-w-xs">
                        {disabledReason}
                      </p>
                    ) : null}
                  </article>
                )
              })
            ) : (
              <EmptyState text="No payouts yet." />
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </main>
  )
}

function PortfolioShell({
  description,
  title,
}: {
  description: string
  title: string
}) {
  return (
    <main className="mx-auto w-full max-w-4xl px-5 pb-16">
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
      </Card>
    </main>
  )
}

function BalanceCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{label}</CardTitle>
        <CardDescription>{value}</CardDescription>
      </CardHeader>
    </Card>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-neutral-500">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return <p className="text-sm text-neutral-500">{text}</p>
}

function formatToken(value: string | undefined, symbol: string) {
  const numericValue = Number(value ?? 0)
  return `${numberFormatter.format(Number.isFinite(numericValue) ? numericValue : 0)} ${symbol}`
}

function formatUsdc(value: string | null | undefined) {
  const numericValue = Number(value ?? 0)
  return `${currencyFormatter.format(Number.isFinite(numericValue) ? numericValue : 0)} USDC`
}

function formatLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function getClaimDisabledReason(
  payout: PortfolioPayout,
  walletAddress: string | null,
  claimConfiguration: ClaimConfiguration
) {
  if (payout.status !== "claimable") {
    return "This payout is not claimable."
  }

  if (!walletAddress) {
    return "Sign in with the payout wallet first."
  }

  if (!payout.market.onchain_market_pubkey) {
    return "This market is not published on-chain yet."
  }

  if (!isValidSolanaPublicKey(payout.market.onchain_market_pubkey)) {
    return "This market is missing a valid on-chain market pubkey."
  }

  if (!payout.onchain_position_ref) {
    return "This payout is missing its on-chain position reference."
  }

  if (!isValidSolanaPublicKey(payout.onchain_position_ref)) {
    return "This payout is missing a valid on-chain position reference."
  }

  if (!claimConfiguration.ready) {
    return claimConfiguration.reason
  }

  return null
}

type ClaimConfiguration =
  | {
    ready: true
    reason: null
    settlementMint: string
    treasuryTokenAccount: string
  }
  | {
    ready: false
    reason: string
  }

function getClaimConfiguration(): ClaimConfiguration {
  const settlementMint = getExoduzeProgramConfig().settlementMint
  const treasuryTokenAccount =
    process.env.NEXT_PUBLIC_TREASURY_TOKEN_ACCOUNT?.trim() ?? ""

  if (!treasuryTokenAccount) {
    return {
      ready: false,
      reason: "Treasury token account is not configured for payout claims.",
    }
  }

  if (!isValidSolanaPublicKey(treasuryTokenAccount)) {
    return {
      ready: false,
      reason:
        "Treasury token account must be a valid Solana public key before payouts can be claimed.",
    }
  }

  if (!settlementMint) {
    return {
      ready: false,
      reason: "Settlement mint is not configured for payout claims.",
    }
  }

  if (!isValidSolanaPublicKey(settlementMint)) {
    return {
      ready: false,
      reason:
        "Settlement mint must be a valid Solana public key before payouts can be claimed.",
    }
  }

  return {
    ready: true,
    reason: null,
    settlementMint,
    treasuryTokenAccount,
  }
}
