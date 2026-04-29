import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { LocalizedDateTimeText } from "@/components/time/LocalizedTime"
import type { MarketMonitoring } from "@/hooks/Type"

import { formatCurrency } from "./market-detail-helpers"

type MarketActivityCardProps = {
  decisionEventCount: number
  monitoring: MarketMonitoring
  settlementAsset: string
  trackedAgentsCount: number
  visibleCompetitionEntriesCount: number
}

export function MarketActivityCard({
  decisionEventCount,
  monitoring,
  settlementAsset,
  trackedAgentsCount,
  visibleCompetitionEntriesCount,
}: MarketActivityCardProps) {
  const monitoringSummary = monitoring.summary

  return (
    <Card>
      <CardHeader>
        <CardTitle>Market Activity</CardTitle>
        <CardDescription>
          High-level coverage for monitoring, support, and decision visibility.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        <div>
          <p className="text-neutral-500">Summary</p>
          <p className="mt-1 font-medium">
            {monitoringSummary
              ? `${monitoringSummary.yes_agents} YES and ${monitoringSummary.no_agents} NO across ${monitoringSummary.total_agents} tracked agents.`
              : "Monitoring summary is not available yet."}
          </p>
        </div>
        <div>
          <p className="text-neutral-500">Total Agents</p>
          <p className="mt-1 font-medium">
            {monitoringSummary?.total_agents ?? 0}
          </p>
        </div>
        <div>
          <p className="text-neutral-500">Yes vs No Agents</p>
          <p className="mt-1 font-medium">
            {monitoringSummary
              ? `${monitoringSummary.yes_agents} YES / ${monitoringSummary.no_agents} NO`
              : "No data yet"}
          </p>
        </div>
        <div>
          <p className="text-neutral-500">Total Staked</p>
          <p className="mt-1 font-medium">
            {monitoringSummary
              ? formatCurrency(
                  monitoringSummary.total_staked_usdc,
                  settlementAsset
                )
              : `0 ${settlementAsset}`}
          </p>
        </div>
        <div>
          <p className="text-neutral-500">Visible Probability Lines</p>
          <p className="mt-1 font-medium">{visibleCompetitionEntriesCount}</p>
        </div>
        <div>
          <p className="text-neutral-500">Decision Events</p>
          <p className="mt-1 font-medium">{decisionEventCount}</p>
        </div>
        <div>
          <p className="text-neutral-500">Tracked Agents</p>
          <p className="mt-1 font-medium">{trackedAgentsCount}</p>
        </div>
        <div>
          <p className="text-neutral-500">Monitoring Snapshots</p>
          <p className="mt-1 font-medium">{monitoring.curve.length}</p>
        </div>
        <div>
          <p className="text-neutral-500">Last Updated</p>
          <p className="mt-1 font-medium">
            {monitoringSummary ? (
              <LocalizedDateTimeText
                value={monitoringSummary.last_updated_at}
              />
            ) : (
              "TBD"
            )}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
