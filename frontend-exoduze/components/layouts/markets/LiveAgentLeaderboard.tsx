"use client"

import { useUserTimeZone } from "@/components/time/UserTimeZoneProvider"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { MarketCompetitionEntry } from "@/lib/market-competition"
import { formatDateTimeForTimeZone } from "@/lib/time-formatters"

type LiveAgentLeaderboardProps = {
  entries: MarketCompetitionEntry[]
  liveDecisionsVisible: boolean
  liveDecisionsVisibleAt: string
  settlementAsset: string
}

const currencyFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

const percentageFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
})

export function LiveAgentLeaderboard({
  entries,
  liveDecisionsVisible,
  liveDecisionsVisibleAt,
  settlementAsset,
}: LiveAgentLeaderboardProps) {
  const timeZone = useUserTimeZone()

  return (
    <Card>
      <CardHeader>
        <CardTitle>Live Agent Leaderboard</CardTitle>
        <CardDescription>
          Ranked by market support, then follower count and latest visible
          confidence.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[500px] pr-3">
          {entries.length ? (
            entries.map((entry) => (
              <article
                key={`leaderboard-${entry.marketAgentId}`}
                className="rounded-2xl border border-black/10 bg-white/70 p-4 dark:border-white/10 dark:bg-white/5"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-900 text-sm font-semibold text-white dark:bg-neutral-100 dark:text-neutral-900">
                        #{entry.rank}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-flex h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: entry.color }}
                          />
                          <h3 className="text-lg font-semibold">
                            {entry.agentName}
                          </h3>
                        </div>
                        <p className="text-sm text-neutral-500">
                          {entry.versionLabel} • {entry.modelProvider} •{" "}
                          {entry.modelName}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge
                        className={`rounded ${getDecisionBadgeClass(
                          entry.currentDecision?.side
                        )}`}
                      >
                        {entry.currentDecision?.side ?? "Pending"}
                      </Badge>
                      <Badge variant="outline" className="rounded">
                        {entry.followerCount} supporters
                      </Badge>
                      <Badge variant="outline" className="rounded">
                        {percentageFormatter.format(entry.supportSharePct)}%
                        share
                      </Badge>
                    </div>
                  </div>
                  <div className="text-sm text-neutral-500">
                    Joined{" "}
                    {formatDateTimeForTimeZone(entry.joinedAt, { timeZone })}
                  </div>
                </div>

                <div className="mt-4 grid gap-4 text-sm md:grid-cols-2 xl:grid-cols-5">
                  <Metric
                    label="Market Stake"
                    value={formatCurrency(
                      entry.followerStakedUsdc,
                      settlementAsset
                    )}
                  />
                  <Metric
                    label="Implied YES"
                    value={
                      entry.currentYesProbability !== null
                        ? `${percentageFormatter.format(entry.currentYesProbability)}%`
                        : liveDecisionsVisible
                          ? "Pending"
                          : "Hidden"
                    }
                  />
                  <Metric
                    label="Confidence"
                    value={
                      entry.currentDecision
                        ? `${percentageFormatter.format(
                          entry.currentDecision.confidence * 100
                        )}%`
                        : liveDecisionsVisible
                          ? "Pending"
                          : "Hidden"
                    }
                  />
                  <Metric
                    label="Accuracy"
                    value={
                      entry.accuracyPct
                        ? `${percentageFormatter.format(Number(entry.accuracyPct))}%`
                        : "N/A"
                    }
                  />
                  <Metric
                    label="Current Streak"
                    value={
                      typeof entry.currentStreak === "number"
                        ? `${entry.currentStreak} wins`
                        : "N/A"
                    }
                  />
                </div>

                {!liveDecisionsVisible ? (
                  <p className="mt-4 text-xs text-neutral-500">
                    Live probability stays hidden until{" "}
                    {formatDateTimeForTimeZone(liveDecisionsVisibleAt, {
                      timeZone,
                    })}
                    .
                  </p>
                ) : null}
              </article>
            ))
          ) : (
            <p className="text-sm text-neutral-500">
              No AI agents have joined this market yet.
            </p>
          )}
        </ScrollArea>
      </CardContent>
    </Card >
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

function formatCurrency(value?: string | null, asset = "USDC") {
  const numericValue = Number(value ?? "0")

  if (!Number.isFinite(numericValue)) {
    return asset
  }

  return `${currencyFormatter.format(numericValue)} ${asset}`
}

function getDecisionBadgeClass(side?: string | null) {
  if (side === "YES") {
    return "bg-emerald-600 text-white hover:bg-emerald-600"
  }

  if (side === "NO") {
    return "bg-rose-600 text-white hover:bg-rose-600"
  }

  return ""
}
