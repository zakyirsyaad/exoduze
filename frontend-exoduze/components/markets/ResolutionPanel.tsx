"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { TopAgentBonusBadge } from "@/components/markets/TopAgentBonusBadge"
import { useUserTimeZone } from "@/components/time/UserTimeZoneProvider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { useAuth } from "@/hooks/useAuth"
import type { MarketAgent, MarketDetail } from "@/hooks/Type"
import { apiFetch } from "@/lib/api"
import { formatDateTimeForTimeZone } from "@/lib/time-formatters"
import {
  formatCurrency,
  formatTextLabel,
} from "@/components/layouts/markets/market-detail-helpers"

type ResolutionPanelProps = {
  market: MarketDetail
  agents: MarketAgent[]
}

export function ResolutionPanel({ market, agents }: ResolutionPanelProps) {
  const auth = useAuth()
  const router = useRouter()
  const timeZone = useUserTimeZone()
  const [reason, setReason] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)
  const [nowMs, setNowMs] = React.useState<number | null>(null)
  const resolution = market.resolution
  const settlementSummary = resolution.settlement_summary
  const canDispute =
    nowMs !== null &&
    resolution.resolution_id &&
    resolution.proposal_status === "proposed" &&
    resolution.dispute_deadline &&
    Date.parse(resolution.dispute_deadline) > nowMs
  const topRankedAgents = React.useMemo(() => {
    if (!settlementSummary?.top_ranked_market_agent_ids.length) {
      return []
    }

    const agentNameByMarketAgentId = new Map(
      agents.map((marketAgent) => [
        marketAgent.market_agent_id,
        marketAgent.agent.name,
      ])
    )

    return settlementSummary.top_ranked_market_agent_ids.map(
      (marketAgentId) => ({
        id: marketAgentId,
        name: agentNameByMarketAgentId.get(marketAgentId) ?? "AI Agent",
      })
    )
  }, [agents, settlementSummary?.top_ranked_market_agent_ids])

  React.useEffect(() => {
    const timeoutId = window.setTimeout(() => setNowMs(Date.now()), 0)
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 30_000)

    return () => {
      window.clearTimeout(timeoutId)
      window.clearInterval(intervalId)
    }
  }, [])

  async function disputeResolution() {
    if (!resolution.resolution_id || !canDispute) {
      return
    }

    setSubmitting(true)
    try {
      await apiFetch(
        `/v1/markets/${encodeURIComponent(
          market.slug
        )}/resolutions/${encodeURIComponent(resolution.resolution_id)}/dispute`,
        {
          method: "POST",
          body: JSON.stringify({ reason }),
        }
      )
      toast.success("Resolution disputed")
      setReason("")
      router.refresh()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to dispute resolution"
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Resolution</CardTitle>
        <CardDescription>
          Oracle proposal, snapshot evidence, and dispute status.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        <div className="grid gap-4 md:grid-cols-2">
          <ResolutionField
            label="Oracle Source"
            value={formatLabel(resolution.oracle_source)}
          />
          <ResolutionField
            label="Oracle Status"
            value={formatLabel(resolution.oracle_status)}
          />
          <ResolutionField
            label="Proposed Outcome"
            value={resolution.proposed_outcome ?? "Pending"}
          />
          <ResolutionField
            label="Final Outcome"
            value={resolution.final_outcome ?? "Pending"}
          />
          <ResolutionField
            label="Snapshot Generated"
            value={formatDateTimeForTimeZone(
              resolution.evidence_snapshot?.generated_at,
              { timeZone }
            )}
          />
          <ResolutionField
            label="Dispute Deadline"
            value={formatDateTimeForTimeZone(resolution.dispute_deadline, {
              timeZone,
            })}
          />
        </div>

        {resolution.evidence_summary ? (
          <div className="rounded-md border border-black/10 p-3 dark:border-white/10">
            <p className="text-neutral-500">Evidence Summary</p>
            <p className="mt-1 leading-6">{resolution.evidence_summary}</p>
          </div>
        ) : (
          <p className="rounded-md border border-dashed p-3 text-neutral-500">
            Snapshot evidence is not available yet.
          </p>
        )}

        {settlementSummary ? (
          <div className="grid gap-3 rounded-md border border-black/10 p-3 dark:border-white/10">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium">Settlement Summary</p>
                <p className="text-xs text-neutral-500">
                  Final payout split for the resolved market.
                </p>
              </div>
              {Number(settlementSummary.top_agent_bonus_pool_usdc) > 0 ? (
                <TopAgentBonusBadge />
              ) : null}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <ResolutionField
                label="Winning Stake"
                value={formatCurrency(
                  settlementSummary.winning_stake_usdc,
                  market.settlement.asset
                )}
              />
              <ResolutionField
                label="Losing Stake"
                value={formatCurrency(
                  settlementSummary.losing_stake_usdc,
                  market.settlement.asset
                )}
              />
              <ResolutionField
                label="Base Pool To Winners"
                value={formatCurrency(
                  settlementSummary.base_prize_pool_usdc,
                  market.settlement.asset
                )}
              />
              <ResolutionField
                label="Top AI Bonus Pool"
                value={formatCurrency(
                  settlementSummary.top_agent_bonus_pool_usdc,
                  market.settlement.asset
                )}
              />
              <ResolutionField
                label="Gross To Winners"
                value={formatCurrency(
                  settlementSummary.total_gross_usdc,
                  market.settlement.asset
                )}
              />
              <ResolutionField
                label="Total Fees"
                value={formatCurrency(
                  settlementSummary.total_fee_usdc,
                  market.settlement.asset
                )}
              />
              <ResolutionField
                label="Net Claimable"
                value={formatCurrency(
                  settlementSummary.total_net_usdc,
                  market.settlement.asset
                )}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
              <Badge variant="outline" className="rounded">
                Fee {formatBps(settlementSummary.fee_bps)}
              </Badge>
              <Badge variant="outline" className="rounded">
                Top AI Bonus {formatBps(settlementSummary.top_agent_bonus_bps)}
              </Badge>
            </div>
            {topRankedAgents.length ? (
              <div className="grid gap-2">
                <p className="text-xs text-neutral-500">Top-Ranked Winning AI</p>
                <div className="flex flex-wrap gap-2">
                  {topRankedAgents.map((agent) => (
                    <Badge key={agent.id} variant="secondary" className="rounded">
                      {agent.name}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {resolution.dispute ? (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">Dispute</p>
              <Badge variant="outline" className="rounded">
                {formatLabel(resolution.dispute.status)}
              </Badge>
            </div>
            <p className="mt-2 text-neutral-600 dark:text-neutral-300">
              {resolution.dispute.reason ?? "No reason provided"}
            </p>
          </div>
        ) : null}

        {canDispute ? (
          <div className="grid gap-3">
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="min-h-24 rounded-md border border-input bg-input/20 p-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30"
              placeholder="Explain what is wrong with the snapshot evidence or rank lookup."
            />
            <Button
              onClick={disputeResolution}
              disabled={
                !auth.isAuthenticated || submitting || reason.trim().length < 10
              }
            >
              {submitting ? "Submitting..." : "Dispute Resolution"}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function ResolutionField({
  label,
  value,
}: {
  label: string
  value: React.ReactNode
}) {
  return (
    <div>
      <p className="text-neutral-500">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  )
}

function formatLabel(value?: string | null) {
  return formatTextLabel(value)
}

function formatBps(value: number) {
  return `${(value / 100).toFixed(value % 100 === 0 ? 0 : 2)}%`
}
