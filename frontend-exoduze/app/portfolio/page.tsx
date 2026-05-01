"use client"

import * as React from "react"
import Link from "next/link"
import { HugeiconsIcon } from "@hugeicons/react"
import { RefreshIcon, Wallet01Icon } from "@hugeicons/core-free-icons"
import { useWallet } from "@solana/react-hooks"
import { toast } from "sonner"

import { PayoutBreakdown } from "@/components/markets/PayoutBreakdown"
import { TopAgentBonusBadge } from "@/components/markets/TopAgentBonusBadge"
import { ClaimPayoutDialog } from "@/components/portfolio/ClaimPayoutDialog"
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
  const [claimDialogPayoutId, setClaimDialogPayoutId] = React.useState<
    string | null
  >(null)

  const walletAddress = auth.session?.wallet.wallet_address ?? null
  const connectedWallet =
    wallet.status === "connected"
      ? wallet.session.account.address.toString()
      : null
  const claimConfiguration = React.useMemo(() => getClaimConfiguration(), [])
  const claimDialogPayout = React.useMemo(
    () =>
      portfolio?.data.payouts.find(
        (payout) => payout.id === claimDialogPayoutId
      ) ?? null,
    [claimDialogPayoutId, portfolio?.data.payouts]
  )

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
      setError(getPortfolioErrorMessage(err))
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

  const openClaimDialog = React.useCallback(
    (payout: PortfolioPayout) => {
      const disabledReason = getClaimDisabledReason(
        payout,
        walletAddress,
        claimConfiguration
      )

      if (disabledReason) {
        toast.error(disabledReason)
        return
      }

      setClaimDialogPayoutId(payout.id)
    },
    [claimConfiguration, walletAddress]
  )

  const handleClaimDialogOpenChange = React.useCallback(
    (open: boolean) => {
      if (claimingPayoutId) {
        return
      }

      if (!open) {
        setClaimDialogPayoutId(null)
      }
    },
    [claimingPayoutId]
  )

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
        setClaimDialogPayoutId(null)
        toast.success("Payout claim submitted")
      } catch (err) {
        toast.error(getClaimErrorMessage(err))
      } finally {
        setClaimingPayoutId(null)
      }
    },
    [claimConfiguration, claimPayout, walletAddress]
  )

  if (auth.loading) {
    return (
      <PortfolioShell
        title="Portfolio"
        description="Checking wallet session..."
      />
    )
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
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 pb-16 sm:px-5">
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
          className="w-full sm:w-auto"
          onClick={() => void loadPortfolio()}
          disabled={loading}
        >
          <HugeiconsIcon icon={RefreshIcon} />
          {loading ? "Refreshing..." : "Refresh"}
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

      <section className="grid gap-6 xl:grid-cols-[1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>User Participant</CardTitle>
            <CardDescription>
              Markets where this wallet opened a position.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <ScrollArea className="h-[360px] pr-3 sm:h-[500px]">
              {data?.user_participants.length ? (
                data.user_participants.map((item) => (
                  <article
                    key={item.position.id}
                    className="rounded-md border border-black/10 p-4 dark:border-white/10"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/markets/${item.market.slug}`}
                            className="font-medium hover:underline"
                          >
                            {item.market.title}
                          </Link>
                          {item.agent.top_bonus_eligible ? (
                            <TopAgentBonusBadge />
                          ) : null}
                        </div>
                        <p className="mt-1 text-sm text-neutral-500">
                          Following {item.agent.name}
                        </p>
                      </div>
                      <Badge variant="outline" className="rounded">
                        {formatLabel(item.position.status)}
                      </Badge>
                    </div>
                    <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
                      <Metric
                        label="Stake"
                        value={formatUsdc(item.position.stake_usdc)}
                      />
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
                <EmptyState
                  title="No positions yet"
                  text="Open a position from a market page and it will appear here after backend sync."
                />
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
            <ScrollArea className="h-[360px] pr-3 sm:h-[500px]">
              {data?.ai_battles.length ? (
                data.ai_battles.map((item) => (
                  <article
                    key={item.market_agent_id}
                    className="rounded-md border border-black/10 p-4 dark:border-white/10"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/markets/${item.market.slug}`}
                            className="font-medium hover:underline"
                          >
                            {item.agent.name}
                          </Link>
                          {item.top_bonus_eligible ? (
                            <TopAgentBonusBadge />
                          ) : null}
                        </div>
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
                <EmptyState
                  title="No AI battles yet"
                  text="Agents owned by this wallet will show here after they join a market."
                />
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Manual Claims</CardTitle>
          <CardDescription>
            Review the payout breakdown, then sign the claim transaction from
            your wallet.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {!claimConfiguration.ready ? (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-300">
              {claimConfiguration.reason}
            </p>
          ) : null}
          <ScrollArea className="h-[360px] pr-3 sm:h-[500px]">
            {data?.payouts.length ? (
              data.payouts.map((payout) => {
                const disabledReason = getClaimDisabledReason(
                  payout,
                  walletAddress,
                  claimConfiguration
                )
                const canClaim =
                  payout.status === "claimable" && !disabledReason

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
                        {payout.top_bonus_eligible ? (
                          <TopAgentBonusBadge />
                        ) : null}
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
                    <div className="flex w-full flex-col items-start gap-2 md:w-auto md:min-w-[220px] md:items-end">
                      <div className="space-y-1 text-left md:text-right">
                        <p className="text-[11px] tracking-normal text-neutral-500 uppercase">
                          Claimable total
                        </p>
                        <p className="text-sm font-medium">
                          {formatUsdc(
                            payout.breakdown?.net_usdc ?? payout.net_usdc
                          )}
                        </p>
                      </div>
                      {payout.breakdown ? (
                        <PayoutBreakdown breakdown={payout.breakdown} />
                      ) : null}
                      <Button
                        type="button"
                        disabled={!canClaim || claimingPayoutId !== null}
                        onClick={() => openClaimDialog(payout)}
                      >
                        <HugeiconsIcon icon={Wallet01Icon} />
                        Review claim
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
                <EmptyState
                  title="No payouts yet"
                  text="Claimable payouts appear here after a market settles and this wallet has a winning position."
                />
              )}
          </ScrollArea>
        </CardContent>
      </Card>
      <ClaimPayoutDialog
        open={Boolean(claimDialogPayout)}
        onOpenChange={handleClaimDialogOpenChange}
        payout={claimDialogPayout}
        submitting={claimingPayoutId === claimDialogPayout?.id}
        onConfirm={() => {
          if (claimDialogPayout) {
            void handleClaim(claimDialogPayout)
          }
        }}
        disabledReason={
          claimDialogPayout
            ? getClaimDisabledReason(
                claimDialogPayout,
                walletAddress,
                claimConfiguration
              )
            : null
        }
      />
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

function EmptyState({ text, title }: { text: string; title: string }) {
  return (
    <div className="rounded-md border border-dashed border-black/10 p-4 text-sm dark:border-white/10">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-neutral-500">{text}</p>
    </div>
  )
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

function getPortfolioErrorMessage(error: unknown) {
  if (error instanceof Error && /auth|session|wallet/i.test(error.message)) {
    return "Your wallet session could not be verified. Reconnect your wallet and try again."
  }

  return "Portfolio data is temporarily unavailable. Try refreshing in a moment."
}

function getClaimErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : ""

  if (/wallet|connect|sign/i.test(message)) {
    return "Connect the payout wallet and approve the claim transaction to continue."
  }

  if (/balance|insufficient|rent|fee/i.test(message)) {
    return "The claim could not be submitted. Check SOL for fees and the expected token accounts, then try again."
  }

  if (/not observed|not found|sync|confirm/i.test(message)) {
    return "The claim transaction was submitted, but confirmation is still syncing. Wait a few seconds and refresh the portfolio."
  }

  return "Unable to claim payout right now. Review the payout status and try again."
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
