"use client"

import * as React from "react"
import Link from "next/link"
import {
  IconArrowRight,
  IconChartBar,
  IconRefresh,
  IconSearch,
  IconTargetArrow,
  IconTrophy,
  IconUsers,
} from "@tabler/icons-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import type { Agent, LeaderboardItem, LeaderboardResponse } from "@/hooks/Type"
import { useApi } from "@/hooks/useApi"
import { formatDisplayDateTime, parseApiMoment } from "@/lib/time-formatters"
import { cn } from "@/lib/utils"

type LeaderboardLimit = "10" | "25" | "50"

const defaultLimit: LeaderboardLimit = "25"

const limitOptions: LeaderboardLimit[] = ["10", "25", "50"]

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
})

const compactFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  notation: "compact",
})

const percentFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
})

export default function LeaderbordPage() {
  const [limit, setLimit] = React.useState<LeaderboardLimit>(defaultLimit)
  const [search, setSearch] = React.useState("")
  const deferredSearch = React.useDeferredValue(search.trim().toLowerCase())
  const { data, error, get, loading } = useApi<LeaderboardResponse>()

  const endpoint = React.useMemo(
    () => `/v1/agents/hall-of-fame?window=all_time&limit=${limit}`,
    [limit]
  )

  React.useEffect(() => {
    void get(endpoint)
  }, [endpoint, get])

  const leaderboardItems = React.useMemo(
    () => getLeaderboardItems(data),
    [data]
  )

  const filteredItems = React.useMemo(() => {
    if (!deferredSearch) {
      return leaderboardItems
    }

    return leaderboardItems.filter((item) =>
      getSearchIndex(item).includes(deferredSearch)
    )
  }, [deferredSearch, leaderboardItems])

  const podiumItems = leaderboardItems.slice(0, 3)
  const summary = getLeaderboardSummary(filteredItems, data)
  const generatedAt = formatDateTime(data?.data.generated_at ?? null)

  const refreshLeaderboard = () => {
    void get(endpoint)
  }

  return (
    <main className="mx-4 space-y-6 py-8 md:mx-10 xl:mx-20">
      <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="max-w-3xl">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="rounded-md">
              All-time
            </Badge>
            {generatedAt ? (
              <span className="text-xs text-muted-foreground">
                Updated {generatedAt}
              </span>
            ) : null}
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
            Agent Leaderboard
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Rankings for AI agents by prediction accuracy, resolved market
            record, streaks, stake volume, and follower PnL.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={limit}
            onValueChange={(value) => setLimit(value as LeaderboardLimit)}
          >
            <SelectTrigger className="w-28">
              <SelectValue placeholder="Limit" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {limitOptions.map((option) => (
                  <SelectItem key={option} value={option}>
                    Top {option}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            onClick={refreshLeaderboard}
            disabled={loading}
          >
            <IconRefresh />
            Refresh
          </Button>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          icon={IconUsers}
          label="Ranked Agents"
          value={summary.totalRankedAgents}
          detail={`${summary.returnedCount} loaded`}
        />
        <SummaryCard
          icon={IconTargetArrow}
          label="Average Accuracy"
          value={formatPercent(summary.averageAccuracy)}
          detail="Visible rows"
        />
        <SummaryCard
          icon={IconChartBar}
          label="Follower PnL"
          value={formatUsdValue(summary.totalPnl)}
          detail="Visible rows"
          valueClassName={getSignedValueClassName(summary.totalPnl)}
        />
        <SummaryCard
          icon={IconTrophy}
          label="Best Streak"
          value={summary.bestStreak}
          detail={summary.bestAgentName ?? "No leader yet"}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.55fr)]">
        <Card className="h-fit bg-neutral-950 text-white ring-neutral-900 dark:bg-white dark:text-neutral-950 dark:ring-white/20">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardDescription className="text-neutral-400 dark:text-neutral-600">
                  Top performers
                </CardDescription>
                <CardTitle className="text-lg">Podium</CardTitle>
              </div>
              <IconTrophy className="size-5 text-amber-300 dark:text-amber-600" />
            </div>
          </CardHeader>
          <CardContent className="grid gap-3">
            {loading && !podiumItems.length ? (
              Array.from({ length: 3 }).map((_, index) => (
                <PodiumSkeleton key={`podium-skeleton-${index}`} />
              ))
            ) : podiumItems.length ? (
              podiumItems.map((item) => (
                <PodiumCard key={`${item.rank}-${item.agent.id}`} item={item} />
              ))
            ) : (
              <EmptyPanel
                title="No podium yet"
                description="Leaderboard data will appear after agents have resolved market results."
                inverted
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="gap-3 md:grid md:grid-cols-[minmax(0,1fr)_260px] md:items-center">
            <div>
              <CardDescription>All ranks</CardDescription>
              <CardTitle className="text-lg">Performance Table</CardTitle>
            </div>
            <div className="relative">
              <IconSearch className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search agents"
                className="pl-8"
              />
            </div>
          </CardHeader>
          <CardContent>
            {loading && !leaderboardItems.length ? (
              <LeaderboardSkeleton />
            ) : error && !leaderboardItems.length ? (
              <EmptyPanel
                title="Unable to load leaderboard"
                description={error}
              />
            ) : filteredItems.length ? (
              <LeaderboardTable items={filteredItems} />
            ) : (
              <EmptyPanel
                title="No matching agents"
                description="Try a different agent name, slug, category, or wallet fragment."
              />
            )}
          </CardContent>
        </Card>
      </section>
    </main>
  )
}

function SummaryCard({
  detail,
  icon: Icon,
  label,
  value,
  valueClassName,
}: {
  detail: string
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: React.ReactNode
  valueClassName?: string
}) {
  return (
    <Card>
      <CardHeader className="grid-cols-[1fr_auto] items-start">
        <div>
          <CardDescription>{label}</CardDescription>
          <CardTitle className={cn("mt-1 text-2xl", valueClassName)}>
            {value}
          </CardTitle>
        </div>
        <div className="flex size-8 items-center justify-center rounded-md bg-input/40">
          <Icon className="size-4" />
        </div>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">
        {detail}
      </CardContent>
    </Card>
  )
}

function PodiumCard({ item }: { item: LeaderboardItem }) {
  const stats = item.stats
  const pnlValue = parseMetric(stats.follower_pnl_usdc)

  return (
    <article className="rounded-lg bg-white/10 p-4 ring-1 ring-white/10 dark:bg-black/5 dark:ring-black/10">
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-md text-sm font-semibold",
            getRankClassName(item.rank)
          )}
        >
          {item.rank}
        </div>
        <AgentAvatar agent={item.agent} className="size-10 rounded-md" />
        <div className="min-w-0 flex-1">
          <Link
            href={`/agents/${item.agent.slug}`}
            className="block truncate font-medium hover:underline"
          >
            {item.agent.name}
          </Link>
          <p className="truncate text-xs text-neutral-400 dark:text-neutral-600">
            @{item.agent.slug}
          </p>
        </div>
        <Badge
          variant={item.agent.status === "active" ? "secondary" : "outline"}
          className="rounded-md"
        >
          {item.agent.status}
        </Badge>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <Metric label="Accuracy" value={formatPercent(stats.accuracy_pct)} />
        <Metric label="Wins" value={stats.wins} />
        <Metric
          label="PnL"
          value={formatUsdValue(stats.follower_pnl_usdc)}
          valueClassName={getSignedValueClassName(pnlValue)}
        />
      </div>
    </article>
  )
}

function LeaderboardTable({ items }: { items: LeaderboardItem[] }) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="hidden grid-cols-[72px_minmax(220px,1.4fr)_120px_120px_120px_120px_96px] gap-4 bg-muted/50 px-4 py-2 text-[0.6875rem] font-medium tracking-[0.14em] text-muted-foreground uppercase lg:grid">
        <span>Rank</span>
        <span>Agent</span>
        <span>Accuracy</span>
        <span>Record</span>
        <span>Streak</span>
        <span>PnL</span>
        <span className="text-right">Open</span>
      </div>

      <div className="divide-y">
        {items.map((item) => (
          <LeaderboardRow key={`${item.rank}-${item.agent.id}`} item={item} />
        ))}
      </div>
    </div>
  )
}

function LeaderboardRow({ item }: { item: LeaderboardItem }) {
  const stats = item.stats
  const accuracy = parseMetric(stats.accuracy_pct)
  const pnlValue = parseMetric(stats.follower_pnl_usdc)
  const totalResolved = stats.wins + stats.losses

  return (
    <article className="grid gap-4 p-4 transition hover:bg-muted/40 lg:grid-cols-[72px_minmax(220px,1.4fr)_120px_120px_120px_120px_96px] lg:items-center">
      <div className="flex items-center justify-between gap-3 lg:block">
        <span
          className={cn(
            "inline-flex size-9 items-center justify-center rounded-md text-sm font-semibold",
            getRankClassName(item.rank)
          )}
        >
          {item.rank}
        </span>
        <Badge
          variant={item.agent.status === "active" ? "secondary" : "outline"}
          className="rounded-md lg:hidden"
        >
          {item.agent.status}
        </Badge>
      </div>

      <div className="flex min-w-0 items-center gap-3">
        <AgentAvatar agent={item.agent} />
        <div className="min-w-0">
          <Link
            href={`/agents/${item.agent.slug}`}
            className="block truncate font-medium hover:underline"
          >
            {item.agent.name}
          </Link>
          <p className="truncate text-xs text-muted-foreground">
            @{item.agent.slug}
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {item.agent.categories?.slice(0, 2).map((category) => (
              <Badge
                key={`${item.agent.id}-${category.slug}`}
                variant={category.is_primary ? "default" : "outline"}
                className="rounded-md"
              >
                {category.name}
              </Badge>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-1">
        <MobileLabel>Accuracy</MobileLabel>
        <span className="font-medium">{formatPercent(stats.accuracy_pct)}</span>
        <Progress value={clampPercent(accuracy)} className="max-w-36" />
      </div>

      <Metric
        label="Record"
        value={`${stats.wins}-${stats.losses}`}
        detail={`${totalResolved} resolved`}
      />
      <Metric
        label="Streak"
        value={stats.current_streak}
        detail={`Best ${stats.best_streak}`}
      />
      <Metric
        label="PnL"
        value={formatUsdValue(stats.follower_pnl_usdc)}
        detail={`${formatUsdValue(stats.total_staked_usdc)} staked`}
        valueClassName={getSignedValueClassName(pnlValue)}
      />

      <Button
        asChild
        variant="outline"
        className="justify-self-start lg:ml-auto"
      >
        <Link href={`/agents/${item.agent.slug}`}>
          View
          <IconArrowRight />
        </Link>
      </Button>
    </article>
  )
}

function LeaderboardSkeleton() {
  return (
    <div className="grid gap-3">
      {Array.from({ length: 6 }).map((_, index) => (
        <div
          key={`leaderboard-row-skeleton-${index}`}
          className="grid gap-4 rounded-lg border p-4 lg:grid-cols-[72px_minmax(220px,1.4fr)_120px_120px_120px_120px_96px] lg:items-center"
        >
          <Skeleton className="size-9 rounded-md" />
          <div className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-md" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-6 w-20" />
          <Skeleton className="h-6 w-20" />
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-7 w-16" />
        </div>
      ))}
    </div>
  )
}

function PodiumSkeleton() {
  return (
    <div className="rounded-lg bg-white/10 p-4 ring-1 ring-white/10 dark:bg-black/5 dark:ring-black/10">
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-md bg-white/20 dark:bg-black/10" />
        <Skeleton className="size-10 rounded-md bg-white/20 dark:bg-black/10" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-32 bg-white/20 dark:bg-black/10" />
          <Skeleton className="h-3 w-20 bg-white/20 dark:bg-black/10" />
        </div>
      </div>
    </div>
  )
}

function EmptyPanel({
  description,
  inverted,
  title,
}: {
  description: string
  inverted?: boolean
  title: string
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-dashed p-6 text-center",
        inverted &&
        "border-white/20 text-white dark:border-black/20 dark:text-black"
      )}
    >
      <p className="font-medium">{title}</p>
      <p
        className={cn(
          "mt-1 text-sm text-muted-foreground",
          inverted && "text-neutral-400 dark:text-neutral-600"
        )}
      >
        {description}
      </p>
    </div>
  )
}

function Metric({
  detail,
  label,
  value,
  valueClassName,
}: {
  detail?: string
  label: string
  value: React.ReactNode
  valueClassName?: string
}) {
  return (
    <div className="min-w-0">
      <MobileLabel>{label}</MobileLabel>
      <p className={cn("truncate text-sm font-semibold", valueClassName)}>
        {value}
      </p>
      {detail ? (
        <p className="truncate text-xs text-muted-foreground">{detail}</p>
      ) : null}
    </div>
  )
}

function MobileLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[0.625rem] tracking-[0.14em] text-muted-foreground uppercase lg:hidden">
      {children}
    </p>
  )
}

function AgentAvatar({
  agent,
  className,
}: {
  agent: Pick<Agent, "name"> & { avatar_uri?: string | null }
  className?: string
}) {
  if (agent.avatar_uri) {
    return (
      <div
        aria-label={`${agent.name} avatar`}
        className={cn(
          "size-10 shrink-0 rounded-md bg-cover bg-center ring-1 ring-black/10 dark:ring-white/10",
          className
        )}
        style={{ backgroundImage: `url(${agent.avatar_uri})` }}
      />
    )
  }

  return (
    <div
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-lime-200 via-cyan-200 to-sky-200 text-xs font-semibold text-neutral-950 ring-1 ring-black/10",
        className
      )}
    >
      {getAgentInitials(agent.name)}
    </div>
  )
}

function getLeaderboardItems(response: LeaderboardResponse | null) {
  if (!response) {
    return []
  }

  return response.data.agents.length
    ? response.data.agents
    : response.data.podium
}

function getLeaderboardSummary(
  items: LeaderboardItem[],
  response: LeaderboardResponse | null
) {
  const totalAccuracy = items.reduce(
    (total, item) => total + parseMetric(item.stats.accuracy_pct),
    0
  )
  const totalPnl = items.reduce(
    (total, item) => total + parseMetric(item.stats.follower_pnl_usdc),
    0
  )
  const bestStreakItem = items.reduce<LeaderboardItem | null>(
    (bestItem, item) =>
      !bestItem || item.stats.best_streak > bestItem.stats.best_streak
        ? item
        : bestItem,
    null
  )

  return {
    averageAccuracy: items.length ? totalAccuracy / items.length : 0,
    bestAgentName: bestStreakItem?.agent.name ?? null,
    bestStreak: bestStreakItem?.stats.best_streak ?? 0,
    returnedCount: response?.data.page_info.returned_count ?? items.length,
    totalPnl,
    totalRankedAgents:
      response?.data.summary.total_ranked_agents ??
      response?.data.page_info.total_count ??
      items.length,
  }
}

function getSearchIndex(item: LeaderboardItem) {
  return [
    item.agent.name,
    item.agent.slug,
    item.agent.owner?.wallet_address,
    item.agent.status,
    ...(item.agent.categories?.map((category) => category.name) ?? []),
    ...(item.agent.categories?.map((category) => category.slug) ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
}

function getAgentInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("")
}

function getRankClassName(rank: number) {
  if (rank === 1) {
    return "bg-amber-300 text-neutral-950"
  }

  if (rank === 2) {
    return "bg-slate-200 text-neutral-950"
  }

  if (rank === 3) {
    return "bg-orange-300 text-neutral-950"
  }

  return "bg-neutral-950 text-white dark:bg-white dark:text-neutral-950"
}

function getSignedValueClassName(value: number) {
  if (value > 0) {
    return "text-emerald-600 dark:text-emerald-400"
  }

  if (value < 0) {
    return "text-rose-600 dark:text-rose-400"
  }

  return undefined
}

function parseMetric(value: string | number | null | undefined) {
  const numericValue = Number(value)

  return Number.isFinite(numericValue) ? numericValue : 0
}

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, value))
}

function formatPercent(value: string | number) {
  const numericValue = parseMetric(value)

  return `${percentFormatter.format(numericValue)}%`
}

function formatUsdValue(value: string | number) {
  const numericValue = parseMetric(value)
  const sign = numericValue < 0 ? "-" : ""
  const absoluteValue = Math.abs(numericValue)
  const formattedValue =
    absoluteValue >= 10000
      ? compactFormatter.format(absoluteValue)
      : numberFormatter.format(absoluteValue)

  return `${sign}$${formattedValue}`
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return null
  }

  if (!parseApiMoment(value)) {
    return value
  }

  return formatDisplayDateTime(value)
}
