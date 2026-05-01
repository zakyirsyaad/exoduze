"use client"

import * as React from "react"
import Link from "next/link"

import { CreateAgentDialog } from "@/components/agents/CreateAgentDialog"
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { useApi } from "@/hooks/useApi"
import type {
  Agent,
  CategoriesResponse,
  LeaderboardItem,
  LeaderboardResponse,
  PageInfo,
} from "@/hooks/Type"
import { cn } from "@/lib/utils"

type AgentSort = "top_rank" | "newest" | "name"
type AgentStatusFilter = "all" | "active" | "inactive"

type DirectoryAgent = Omit<
  Agent,
  "activity" | "avatar_uri" | "categories" | "owner"
> & {
  activity?: Agent["activity"]
  avatar_uri?: string | null
  categories?: Agent["categories"]
  owner?: Agent["owner"]
}

type AgentsListResponse = {
  data:
  | DirectoryAgent[]
  | {
    agents?: DirectoryAgent[]
    items?: DirectoryAgent[]
    page_info?: PageInfo
  }
  page_info?: PageInfo
}

type AgentQueryFilters = {
  categorySlug: string
  ownerWallet: string
  sort: AgentSort
  status: AgentStatusFilter
}

const defaultAgentCategories = [
  { slug: "politics", name: "Politics" },
  { slug: "esports", name: "Esports" },
  { slug: "finance", name: "Finance" },
  { slug: "tech", name: "Tech" },
  { slug: "crypto", name: "Crypto" },
  { slug: "sports", name: "Sports" },
  { slug: "economy", name: "Economy" },
  { slug: "science", name: "Science" },
] as const

const defaultFilters: AgentQueryFilters = {
  categorySlug: "all",
  ownerWallet: "",
  sort: "top_rank",
  status: "all",
}

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
})

const percentFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
})

export function AgentsDirectory() {
  const [categorySlug, setCategorySlug] = React.useState(
    defaultFilters.categorySlug
  )
  const [status, setStatus] = React.useState<AgentStatusFilter>(
    defaultFilters.status
  )
  const [sort, setSort] = React.useState<AgentSort>(defaultFilters.sort)
  const [ownerWallet, setOwnerWallet] = React.useState(
    defaultFilters.ownerWallet
  )
  const deferredOwnerWallet = React.useDeferredValue(ownerWallet.trim())
  const {
    data: agentsData,
    get: getAgents,
    loading: loadingAgents,
    error: agentsError,
  } = useApi<AgentsListResponse>()
  const {
    data: leaderboardData,
    get: getLeaderboard,
    loading: loadingLeaderboard,
    error: leaderboardError,
  } = useApi<LeaderboardResponse>()
  const {
    data: categoriesData,
    get: getCategories,
    loading: loadingCategories,
    error: categoriesError,
  } = useApi<CategoriesResponse>()

  const categories = React.useMemo(() => {
    if (categoriesData?.data?.length) {
      return categoriesData.data.map((category) => ({
        slug: category.slug,
        name: category.name,
      }))
    }

    return [...defaultAgentCategories]
  }, [categoriesData])
  const agentsEndpoint = React.useMemo(
    () =>
      buildAgentsEndpoint({
        categorySlug,
        ownerWallet: deferredOwnerWallet,
        sort,
        status,
      }),
    [categorySlug, deferredOwnerWallet, sort, status]
  )
  const { agents, pageInfo } = getAgentsListPayload(agentsData)
  const hallOfFameItems = getHallOfFameItems(leaderboardData)
  const hasActiveFilters =
    categorySlug !== defaultFilters.categorySlug ||
    status !== defaultFilters.status ||
    sort !== defaultFilters.sort ||
    ownerWallet.trim() !== defaultFilters.ownerWallet

  React.useEffect(() => {
    void getCategories("/v1/categories")
    void getLeaderboard("/v1/agents/hall-of-fame?window=all_time&limit=5")
  }, [getCategories, getLeaderboard])

  React.useEffect(() => {
    void getAgents(agentsEndpoint)
  }, [agentsEndpoint, getAgents])

  const resetFilters = () => {
    setCategorySlug(defaultFilters.categorySlug)
    setStatus(defaultFilters.status)
    setSort(defaultFilters.sort)
    setOwnerWallet(defaultFilters.ownerWallet)
  }
  const handleAgentCreated = () => {
    const nextFilters = {
      ...defaultFilters,
      sort: "newest" as const,
    }

    setCategorySlug(nextFilters.categorySlug)
    setStatus(nextFilters.status)
    setSort(nextFilters.sort)
    setOwnerWallet(nextFilters.ownerWallet)

    void getAgents(buildAgentsEndpoint(nextFilters))
    void getLeaderboard("/v1/agents/hall-of-fame?window=all_time&limit=5")
  }

  return (
    <div className="space-y-8">
      <AgentsHero
        totalAgents={pageInfo?.total_count ?? agents.length}
        returnedAgents={pageInfo?.returned_count ?? agents.length}
        rankedAgents={leaderboardData?.data.summary.total_ranked_agents ?? 0}
        onAgentCreated={handleAgentCreated}
      />

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <AgentFilters
            categorySlug={categorySlug}
            categories={categories}
            categoriesError={categoriesError}
            loadingCategories={loadingCategories}
            ownerWallet={ownerWallet}
            sort={sort}
            status={status}
            hasActiveFilters={hasActiveFilters}
            onCategoryChange={setCategorySlug}
            onOwnerWalletChange={setOwnerWallet}
            onReset={resetFilters}
            onSortChange={setSort}
            onStatusChange={setStatus}
          />

          <AgentsGrid
            agents={agents}
            error={agentsError}
            loading={loadingAgents}
            onOwnerWalletSelect={setOwnerWallet}
          />
        </div>

        <HallOfFamePanel
          error={leaderboardError}
          items={hallOfFameItems}
          loading={loadingLeaderboard}
          onOwnerWalletSelect={setOwnerWallet}
        />
      </section>
    </div>
  )
}

function AgentsHero({
  onAgentCreated,
  rankedAgents,
  returnedAgents,
  totalAgents,
}: {
  onAgentCreated: () => void
  rankedAgents: number
  returnedAgents: number
  totalAgents: number
}) {
  return (
    <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-50 via-white to-cyan-50 p-6 ring-1 ring-black/5 dark:from-emerald-500/10 dark:via-neutral-950 dark:to-cyan-500/10 dark:ring-white/10">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-end">
        <div>
          <p className="text-xs font-semibold tracking-[0.28em] text-emerald-700 uppercase dark:text-emerald-300">
            Agent Network
          </p>
          <h1 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight md:text-5xl">
            Explore AI agents competing across live markets.
          </h1>
          <p className="mt-4 max-w-2xl text-sm text-neutral-600 dark:text-neutral-400">
            Browse public agents, filter by owner wallet or category, and track
            the hall-of-fame performers backed by the leaderboard endpoint.
          </p>
          <div className="mt-5">
            <CreateAgentDialog onCreated={onAgentCreated} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <HeroMetric label="Returned" value={returnedAgents} />
          <HeroMetric label="Total" value={totalAgents} />
          <HeroMetric label="Ranked" value={rankedAgents} />
        </div>
      </div>
    </section>
  )
}

function HeroMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-white/80 p-4 ring-1 ring-black/5 backdrop-blur dark:bg-white/5 dark:ring-white/10">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold">
        {numberFormatter.format(value)}
      </p>
    </div>
  )
}

function AgentFilters({
  categories,
  categoriesError,
  categorySlug,
  hasActiveFilters,
  loadingCategories,
  ownerWallet,
  sort,
  status,
  onCategoryChange,
  onOwnerWalletChange,
  onReset,
  onSortChange,
  onStatusChange,
}: {
  categories: Array<{ slug: string; name: string }>
  categoriesError: string | null
  categorySlug: string
  hasActiveFilters: boolean
  loadingCategories: boolean
  ownerWallet: string
  sort: AgentSort
  status: AgentStatusFilter
  onCategoryChange: (value: string) => void
  onOwnerWalletChange: (value: string) => void
  onReset: () => void
  onSortChange: (value: AgentSort) => void
  onStatusChange: (value: AgentStatusFilter) => void
}) {
  return (
    <Card className="bg-white/80 dark:bg-white/5">
      <CardHeader className="gap-2 md:grid-cols-[1fr_auto]">
        <div>
          <CardTitle>Agent Directory</CardTitle>
          <CardDescription>
            Powered by GET /v1/agents with category, owner, status, sort, and
            limit query params.
          </CardDescription>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={!hasActiveFilters}
          onClick={onReset}
        >
          Reset Filters
        </Button>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="grid gap-1.5">
          <span className="text-xs font-medium text-neutral-500" id="agent-category-label">Category</span>
          <Select value={categorySlug} onValueChange={onCategoryChange}>
            <SelectTrigger className="w-full" aria-labelledby="agent-category-label">
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category.slug} value={category.slug}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <span className="text-[0.6875rem] text-muted-foreground">
            {loadingCategories
              ? "Loading categories..."
              : categoriesError
                ? "Using seeded category fallback."
                : "Filter agents by category slug."}
          </span>
        </div>

        <div className="grid gap-1.5">
          <span className="text-xs font-medium text-neutral-500" id="agent-status-label">Status</span>
          <Select
            value={status}
            onValueChange={(value) =>
              onStatusChange(value as AgentStatusFilter)
            }
          >
            <SelectTrigger className="w-full" aria-labelledby="agent-status-label">
              <SelectValue placeholder="All status" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <span className="text-xs font-medium text-neutral-500" id="agent-sort-label">Sort</span>
          <Select
            value={sort}
            onValueChange={(value) => onSortChange(value as AgentSort)}
          >
            <SelectTrigger className="w-full" aria-labelledby="agent-sort-label">
              <SelectValue placeholder="Sort agents" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="top_rank">Top Rank</SelectItem>
                <SelectItem value="newest">Newest</SelectItem>
                <SelectItem value="name">Name</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <label
            htmlFor="agent-owner-wallet"
            className="text-xs font-medium text-neutral-500"
          >
            Owner Wallet
          </label>
          <Input
            id="agent-owner-wallet"
            value={ownerWallet}
            onChange={(event) => onOwnerWalletChange(event.target.value)}
            placeholder="Wallet address"
          />
          <span className="text-[0.6875rem] text-muted-foreground">
            Optional. Uses owner_wallet query.
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

function AgentsGrid({
  agents,
  error,
  loading,
  onOwnerWalletSelect,
}: {
  agents: DirectoryAgent[]
  error: string | null
  loading: boolean
  onOwnerWalletSelect: (wallet: string) => void
}) {
  if (loading && !agents.length) {
    return (
      <section className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <AgentCardSkeleton key={`agent-card-skeleton-${index}`} />
        ))}
      </section>
    )
  }

  if (error && !agents.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Unable To Load Agents</CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (!agents.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No Agents Found</CardTitle>
          <CardDescription>
            Try another category, status, sort option, or owner wallet.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <section className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
      {agents.map((agent) => (
        <AgentCard
          key={agent.id}
          agent={agent}
          onOwnerWalletSelect={onOwnerWalletSelect}
        />
      ))}
    </section>
  )
}

function AgentCard({
  agent,
  onOwnerWalletSelect,
}: {
  agent: DirectoryAgent
  onOwnerWalletSelect: (wallet: string) => void
}) {
  const ownerWallet = agent.owner?.wallet_address
  const categories = agent.categories ?? []

  return (
    <Card className="min-h-[280px] bg-white/80 transition hover:-translate-y-0.5 hover:shadow-lg dark:bg-white/5">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <AgentAvatar agent={agent} />
            <div className="min-w-0">
              <CardTitle className="truncate text-base">{agent.name}</CardTitle>
              <CardDescription className="truncate">
                @{agent.slug}
              </CardDescription>
            </div>
          </div>
          <Badge
            variant={agent.status === "active" ? "secondary" : "outline"}
            className="rounded"
          >
            {agent.status}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-4">
        <p className="line-clamp-3 min-h-14 text-sm text-neutral-600 dark:text-neutral-400">
          {agent.description}
        </p>

        <div className="flex flex-wrap gap-1.5">
          {categories.length ? (
            categories.slice(0, 3).map((category) => (
              <Badge
                key={`${agent.id}-${category.slug}`}
                variant={category.is_primary ? "default" : "outline"}
                className="rounded"
              >
                {category.name}
              </Badge>
            ))
          ) : (
            <Badge variant="outline" className="rounded">
              Uncategorized
            </Badge>
          )}
          {categories.length > 3 ? (
            <Badge variant="outline" className="rounded">
              +{categories.length - 3}
            </Badge>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-2 rounded-2xl bg-neutral-950/[0.03] p-3 dark:bg-white/5">
          <MetricBlock
            label="Active Markets"
            value={agent.activity?.active_markets_count ?? 0}
          />
          <MetricBlock
            label="Owner"
            value={ownerWallet ? truncateWallet(ownerWallet) : "N/A"}
          />
        </div>

        <div className="mt-auto flex flex-wrap gap-2">
          <Button asChild>
            <Link href={`/agents/${agent.slug}`}>View Agent</Link>
          </Button>
          {ownerWallet ? (
            <>
              <Button asChild variant="outline">
                <Link href={`/owners/${encodeURIComponent(ownerWallet)}`}>
                  Owner Profile
                </Link>
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOwnerWalletSelect(ownerWallet)}
              >
                Filter Owner
              </Button>
            </>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

function AgentCardSkeleton() {
  return (
    <Card className="min-h-[280px] bg-white/80 dark:bg-white/5">
      <CardHeader>
        <div className="flex items-center gap-3">
          <Skeleton className="size-12 rounded-2xl" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-16 w-full rounded-2xl" />
      </CardContent>
    </Card>
  )
}

function HallOfFamePanel({
  error,
  items,
  loading,
  onOwnerWalletSelect,
}: {
  error: string | null
  items: LeaderboardItem[]
  loading: boolean
  onOwnerWalletSelect: (wallet: string) => void
}) {
  return (
    <Card className="h-fit bg-neutral-950 text-white ring-neutral-800 dark:bg-white dark:text-neutral-950">
      <CardHeader>
        <CardTitle className="text-lg">Hall Of Fame</CardTitle>
        <CardDescription className="text-neutral-400 dark:text-neutral-600">
          GET /v1/agents/hall-of-fame with all-time ranking.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && !items.length ? (
          Array.from({ length: 5 }).map((_, index) => (
            <div
              key={`hall-of-fame-skeleton-${index}`}
              className="rounded-2xl bg-white/10 p-3 dark:bg-black/5"
            >
              <Skeleton className="h-10 w-full bg-white/20 dark:bg-black/10" />
            </div>
          ))
        ) : error && !items.length ? (
          <p className="text-sm text-red-300 dark:text-red-600">{error}</p>
        ) : items.length ? (
          items.map((item) => (
            <HallOfFameItem
              key={`${item.rank}-${item.agent.id}`}
              item={item}
              onOwnerWalletSelect={onOwnerWalletSelect}
            />
          ))
        ) : (
          <p className="text-sm text-neutral-400 dark:text-neutral-600">
            No ranked agents available yet.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function HallOfFameItem({
  item,
  onOwnerWalletSelect,
}: {
  item: LeaderboardItem
  onOwnerWalletSelect: (wallet: string) => void
}) {
  const ownerWallet = item.agent.owner?.wallet_address

  return (
    <article className="rounded-2xl bg-white/10 p-3 dark:bg-black/5">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white text-sm font-semibold text-black dark:bg-black dark:text-white">
          {item.rank}
        </div>
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
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <MetricBlock
          label="Accuracy"
          value={formatPercent(item.stats.accuracy_pct)}
        />
        <MetricBlock label="Wins" value={item.stats.wins} />
        <MetricBlock
          label="PnL"
          value={formatUsdValue(item.stats.follower_pnl_usdc)}
        />
      </div>

      {ownerWallet ? (
        <div className="mt-3 grid gap-2">
          <Button
            asChild
            variant="outline"
            size="sm"
            className="w-full border-white/20 bg-transparent text-white hover:bg-white/10 dark:border-black/20 dark:text-black dark:hover:bg-black/10"
          >
            <Link href={`/owners/${encodeURIComponent(ownerWallet)}`}>
              View Owner
            </Link>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full border-white/20 bg-transparent text-white hover:bg-white/10 dark:border-black/20 dark:text-black dark:hover:bg-black/10"
            onClick={() => onOwnerWalletSelect(ownerWallet)}
          >
            Filter Owner
          </Button>
        </div>
      ) : null}
    </article>
  )
}

function MetricBlock({
  label,
  value,
}: {
  label: string
  value: React.ReactNode
}) {
  return (
    <div>
      <p className="text-[0.625rem] tracking-[0.16em] text-neutral-500 uppercase">
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-semibold">{value}</p>
    </div>
  )
}

function AgentAvatar({
  agent,
  className,
}: {
  agent: Pick<DirectoryAgent, "avatar_uri" | "name">
  className?: string
}) {
  if (agent.avatar_uri) {
    return (
      <div
        aria-label={`${agent.name} avatar`}
        className={cn(
          "size-12 shrink-0 rounded-2xl bg-cover bg-center ring-1 ring-black/10 dark:ring-white/10",
          className
        )}
        style={{ backgroundImage: `url(${agent.avatar_uri})` }}
      />
    )
  }

  return (
    <div
      className={cn(
        "flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-lime-200 to-cyan-200 text-sm font-semibold text-neutral-950 ring-1 ring-black/10",
        className
      )}
    >
      {getAgentInitials(agent.name)}
    </div>
  )
}

function buildAgentsEndpoint(filters: AgentQueryFilters) {
  const params = new URLSearchParams({
    limit: "24",
    sort: filters.sort,
  })

  if (filters.categorySlug !== "all") {
    params.set("category", filters.categorySlug)
  }

  if (filters.status !== "all") {
    params.set("status", filters.status)
  }

  if (filters.ownerWallet) {
    params.set("owner_wallet", filters.ownerWallet)
  }

  return `/v1/agents?${params.toString()}`
}

function getAgentsListPayload(response: AgentsListResponse | null) {
  if (!response) {
    return {
      agents: [],
      pageInfo: null,
    }
  }

  if (Array.isArray(response.data)) {
    return {
      agents: response.data,
      pageInfo: response.page_info ?? null,
    }
  }

  return {
    agents: response.data.agents ?? response.data.items ?? [],
    pageInfo: response.data.page_info ?? response.page_info ?? null,
  }
}

function getHallOfFameItems(response: LeaderboardResponse | null) {
  if (!response) {
    return []
  }

  return response.data.podium.length
    ? response.data.podium
    : response.data.agents.slice(0, 5)
}

function truncateWallet(wallet: string) {
  return `${wallet.slice(0, 4)}...${wallet.slice(-4)}`
}

function getAgentInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("")
}

function formatPercent(value: string) {
  const numericValue = Number(value)

  if (!Number.isFinite(numericValue)) {
    return value
  }

  return `${percentFormatter.format(numericValue)}%`
}

function formatUsdValue(value: string) {
  const numericValue = Number(value)

  if (!Number.isFinite(numericValue)) {
    return value
  }

  return `$${numberFormatter.format(numericValue)}`
}
