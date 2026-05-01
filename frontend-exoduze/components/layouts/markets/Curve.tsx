"use client"

import * as React from "react"
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts"

import { useUserTimeZone } from "@/components/time/UserTimeZoneProvider"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import type { MarketCompetitionEntry } from "@/lib/market-competition"
import {
  formatClockTimeForTimeZone,
  formatDateTimeForTimeZone,
  getApiDateTimestamp,
} from "@/lib/time-formatters"

type CurveProps = {
  entries: MarketCompetitionEntry[]
  marketTitle: string
  marketEndsAt: string
  liveDecisionsVisible: boolean
  liveDecisionsVisibleAt: string
}

type CurveRow = {
  recordedAt: string
  recordedAtTimestamp: number
  [key: string]: number | string | null
}

const stakeFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

export function Curve({
  entries,
  marketTitle,
  marketEndsAt,
  liveDecisionsVisible,
  liveDecisionsVisibleAt,
}: CurveProps) {
  const timeZone = useUserTimeZone()
  const chartConfig = React.useMemo<ChartConfig>(
    () =>
      Object.fromEntries(
        entries.map((entry) => [
          entry.key,
          {
            label: entry.agentName,
            color: entry.color,
          },
        ])
      ),
    [entries]
  )
  const chartData = React.useMemo(
    () => buildChartData(entries, liveDecisionsVisibleAt, marketEndsAt),
    [entries, liveDecisionsVisibleAt, marketEndsAt]
  )
  const latestDecisionRecordedAt = React.useMemo(
    () => getLatestDecisionRecordedAt(entries),
    [entries]
  )
  const latestDecisionTimestamp = getApiDateTimestamp(latestDecisionRecordedAt)
  const chartStartTimestamp =
    getApiDateTimestamp(liveDecisionsVisibleAt) ??
    chartData.at(0)?.recordedAtTimestamp ??
    null
  const chartEndTimestamp =
    getApiDateTimestamp(marketEndsAt) ??
    chartData.at(-1)?.recordedAtTimestamp ??
    null
  const chartTimeDomain = React.useMemo(
    () =>
      chartStartTimestamp !== null &&
        chartEndTimestamp !== null &&
        chartStartTimestamp < chartEndTimestamp
        ? ([chartStartTimestamp, chartEndTimestamp] as [number, number])
        : undefined,
    [chartStartTimestamp, chartEndTimestamp]
  )
  const chartTimeTicks = React.useMemo(
    () => buildTimeTicks(chartTimeDomain),
    [chartTimeDomain]
  )
  const chartEndAt = chartData.at(-1)?.recordedAt ?? null
  const showLatestDecisionLine =
    latestDecisionTimestamp !== null &&
    !isSameApiTimestamp(latestDecisionRecordedAt, chartEndAt)
  const totalDecisionEvents = entries.reduce(
    (total, entry) => total + entry.points.length,
    0
  )
  const visibleProbabilityCount = entries.filter(
    (entry) => entry.currentYesProbability !== null
  ).length
  const totalFollowerStake = entries.reduce(
    (total, entry) => total + parseNumericValue(entry.followerStakedUsdc),
    0
  )
  const hasJoinedAgents = entries.length > 0
  const hasVisibleCurve = chartData.length > 0

  return (
    <Card className="w-full">
      <CardHeader className="pb-2">
        <CardTitle>Live AI Probability Curve</CardTitle>
        <CardDescription>
          {liveDecisionsVisible
            ? `Each line tracks an agent's implied YES probability for ${marketTitle}.`
            : `Live decision signals unlock after the join window closes for ${marketTitle}.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 pt-2">
        {!hasJoinedAgents ? (
          <div className="rounded-2xl border border-dashed border-black/10 px-4 py-10 text-center text-sm text-neutral-500 dark:border-white/10">
            No AI agents have joined this market yet, so there is no live
            probability curve to render.
          </div>
        ) : hasVisibleCurve ? (
          <ChartContainer
            config={chartConfig}
            className="mx-auto aspect-auto h-80 w-full"
            initialDimension={{ width: 920, height: 320 }}
          >
            <LineChart
              accessibilityLayer
              data={chartData}
              margin={{
                left: 12,
                right: 12,
              }}
            >
              <CartesianGrid vertical={false} />
              <YAxis
                domain={[0, 100]}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                width={52}
                tickFormatter={(value) => `${value}%`}
              />
              <XAxis
                dataKey="recordedAtTimestamp"
                type="number"
                scale="time"
                domain={chartTimeDomain}
                ticks={chartTimeTicks}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={32}
                tickFormatter={(value) =>
                  formatTimestampClockForTimeZone(value, { timeZone })
                }
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    indicator="line"
                    labelFormatter={(_value, payload) =>
                      formatDateTimeForTimeZone(
                        payload?.[0]?.payload?.recordedAt,
                        { timeZone }
                      )
                    }
                    formatter={(value, name) => {
                      const seriesName = entries.find(
                        (entry) => entry.key === name
                      )?.agentName

                      return (
                        <span className="font-mono font-medium tabular-nums">
                          {seriesName ?? String(name)}:{" "}
                          {Number(value).toFixed(1)}%
                        </span>
                      )
                    }}
                  />
                }
              />
              {showLatestDecisionLine ? (
                <ReferenceLine
                  x={latestDecisionTimestamp}
                  stroke="hsl(var(--muted-foreground))"
                  strokeDasharray="4 4"
                  ifOverflow="extendDomain"
                  label={{
                    value: "Latest",
                    position: "top",
                    fill: "hsl(var(--muted-foreground))",
                    fontSize: 11,
                  }}
                />
              ) : null}
              {entries.map((entry) => (
                <Line
                  key={entry.key}
                  dataKey={entry.key}
                  type="stepAfter"
                  stroke={`var(--color-${entry.key})`}
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 4 }}
                  connectNulls
                />
              ))}
            </LineChart>
          </ChartContainer>
        ) : (
          <div className="rounded-2xl border border-dashed border-black/10 bg-black/[0.02] px-4 py-8 dark:border-white/10 dark:bg-white/[0.03]">
            <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
              {liveDecisionsVisible
                ? "Visible live decisions are not available yet."
                : "Live probability is currently locked."}
            </p>
            <p className="mt-2 text-sm text-neutral-500">
              {liveDecisionsVisible
                ? "The agents have joined, but they have not submitted a visible decision update yet."
                : `Agent decisions stay hidden until ${formatDateTimeForTimeZone(liveDecisionsVisibleAt, { timeZone })} to protect join fairness.`}
            </p>
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {entries.map((entry) => (
            <article
              key={`curve-entry-${entry.marketAgentId}`}
              className="rounded-2xl border border-black/10 bg-white/70 p-4 dark:border-white/10 dark:bg-white/5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-flex h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: entry.color }}
                    />
                    <p className="font-semibold">{entry.agentName}</p>
                  </div>
                  <p className="text-xs text-neutral-500">
                    Rank #{entry.rank} • {entry.modelProvider} •{" "}
                    {entry.modelName}
                  </p>
                </div>
                <Badge variant="outline" className="rounded">
                  {entry.versionLabel}
                </Badge>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-neutral-500">Implied YES</p>
                  <p className="mt-1 text-lg font-semibold">
                    {entry.currentYesProbability !== null
                      ? `${entry.currentYesProbability}%`
                      : liveDecisionsVisible
                        ? "Pending"
                        : "Hidden"}
                  </p>
                </div>
                <div>
                  <p className="text-neutral-500">Decision</p>
                  <p className="mt-1 font-medium">
                    {entry.currentDecision?.side ?? "Pending"}
                  </p>
                </div>
                <div>
                  <p className="text-neutral-500">Followers</p>
                  <p className="mt-1 font-medium">{entry.followerCount}</p>
                </div>
                <div>
                  <p className="text-neutral-500">Support Share</p>
                  <p className="mt-1 font-medium">{entry.supportSharePct}%</p>
                </div>
                <div>
                  <p className="text-neutral-500">Market Stake</p>
                  <p className="mt-1 font-medium">
                    {formatStakeValue(entry.followerStakedUsdc)}
                  </p>
                </div>
                <div>
                  <p className="text-neutral-500">Last Update</p>
                  <p className="mt-1 font-medium">
                    {entry.currentDecision?.decided_at
                      ? formatClockTimeForTimeZone(
                        entry.currentDecision.decided_at,
                        { timeZone }
                      )
                      : "TBD"}
                  </p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </CardContent>
      <CardFooter className="pt-0">
        <div className="flex w-full flex-col gap-1 text-sm text-muted-foreground">
          {hasVisibleCurve ? (
            <>
              <p className="font-medium text-foreground">
                {visibleProbabilityCount} competing agents are currently plotted
                on the live curve.
              </p>
              <p>
                Latest update{" "}
                {latestDecisionRecordedAt
                  ? formatDateTimeForTimeZone(latestDecisionRecordedAt, {
                    timeZone,
                  })
                  : "unavailable"}
                . {totalDecisionEvents} visible decision events across{" "}
                {entries.length} agents, with{" "}
                {formatStakeValue(totalFollowerStake)} of tracked support in
                this market. Curve extends through{" "}
                {chartEndAt
                  ? formatDateTimeForTimeZone(chartEndAt, { timeZone })
                  : "the market end"}
                .
              </p>
            </>
          ) : (
            <p>
              {liveDecisionsVisible
                ? "Curve data will appear as soon as the participating agents publish visible decision updates."
                : `The market already tracks ${entries.length} competing agents and ${formatStakeValue(totalFollowerStake)} in visible support, but live probabilities remain locked until the join deadline passes.`}
            </p>
          )}
        </div>
      </CardFooter>
    </Card>
  )
}

function buildChartData(
  entries: MarketCompetitionEntry[],
  windowStartsAt: string,
  marketEndsAt: string
) {
  const timestamps = Array.from(
    new Set(
      entries.flatMap((entry) => entry.points.map((point) => point.recordedAt))
    )
  ).sort(compareApiDateStrings)
  const chartTimestamps = buildChartTimeline(
    timestamps,
    windowStartsAt,
    marketEndsAt
  )

  return chartTimestamps.map<CurveRow>((timestamp) => {
    const row: CurveRow = {
      recordedAt: timestamp.recordedAt,
      recordedAtTimestamp: timestamp.recordedAtTimestamp,
    }

    for (const entry of entries) {
      const latestPoint = findLatestPointAtOrBefore(entry, timestamp.recordedAt)
      row[entry.key] = latestPoint?.yesProbability ?? null
    }

    return row
  })
}

function buildChartTimeline(
  timestamps: string[],
  windowStartsAt: string,
  terminalAt: string
) {
  if (timestamps.length === 0) {
    return []
  }

  const timelineByTimestamp = new Map<number, string>()
  const addTimestamp = (value: string) => {
    const timestamp = getApiDateTimestamp(value)

    if (timestamp === null) {
      return
    }

    if (!timelineByTimestamp.has(timestamp)) {
      timelineByTimestamp.set(timestamp, value)
    }
  }

  addTimestamp(windowStartsAt)

  for (const timestamp of timestamps) {
    addTimestamp(timestamp)
  }

  addTimestamp(terminalAt)

  return Array.from(timelineByTimestamp.entries())
    .sort(([left], [right]) => left - right)
    .map(([recordedAtTimestamp, recordedAt]) => ({
      recordedAt,
      recordedAtTimestamp,
    }))
}

function buildTimeTicks(domain?: [number, number]) {
  if (!domain) {
    return undefined
  }

  const [startTimestamp, endTimestamp] = domain
  const tickCount = 5
  const step = (endTimestamp - startTimestamp) / (tickCount - 1)

  return Array.from({ length: tickCount }, (_item, index) =>
    index === tickCount - 1
      ? endTimestamp
      : Math.round(startTimestamp + step * index)
  )
}

function getLatestDecisionRecordedAt(entries: MarketCompetitionEntry[]) {
  let latestTimestamp: number | null = null
  let latestRecordedAt: string | null = null

  for (const entry of entries) {
    for (const point of entry.points) {
      const pointTimestamp = getApiDateTimestamp(point.recordedAt)

      if (pointTimestamp === null) {
        continue
      }

      if (latestTimestamp === null || pointTimestamp > latestTimestamp) {
        latestTimestamp = pointTimestamp
        latestRecordedAt = point.recordedAt
      }
    }
  }

  return latestRecordedAt
}

function findLatestPointAtOrBefore(
  entry: MarketCompetitionEntry,
  timestamp: string
) {
  const target = getApiDateTimestamp(timestamp)
  let latestPoint = null as MarketCompetitionEntry["points"][number] | null

  if (target === null) {
    return latestPoint
  }

  for (const point of entry.points) {
    const pointTimestamp = getApiDateTimestamp(point.recordedAt)

    if (pointTimestamp === null) {
      continue
    }

    if (pointTimestamp > target) {
      break
    }

    latestPoint = point
  }

  return latestPoint
}

function isSameApiTimestamp(left?: string | null, right?: string | null) {
  const leftTimestamp = getApiDateTimestamp(left)
  const rightTimestamp = getApiDateTimestamp(right)

  return leftTimestamp !== null && leftTimestamp === rightTimestamp
}

function formatTimestampClockForTimeZone(
  value: number | string,
  { timeZone }: { timeZone: string }
) {
  const timestamp = typeof value === "number" ? value : Number(value)

  if (!Number.isFinite(timestamp)) {
    return "TBD"
  }

  return formatClockTimeForTimeZone(new Date(timestamp).toISOString(), {
    timeZone,
  })
}

function parseNumericValue(value?: string | null) {
  const numericValue = Number(value ?? "0")

  return Number.isFinite(numericValue) ? numericValue : 0
}

function compareApiDateStrings(left: string, right: string) {
  const leftTimestamp = getApiDateTimestamp(left)
  const rightTimestamp = getApiDateTimestamp(right)

  if (leftTimestamp === rightTimestamp) {
    return 0
  }

  if (leftTimestamp === null) {
    return 1
  }

  if (rightTimestamp === null) {
    return -1
  }

  return leftTimestamp - rightTimestamp
}

function formatStakeValue(value: number | string) {
  const numericValue =
    typeof value === "number" ? value : parseNumericValue(value)

  return `${stakeFormatter.format(numericValue)} USDC`
}
