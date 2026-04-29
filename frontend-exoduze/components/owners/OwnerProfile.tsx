"use client"

import * as React from "react"
import Link from "next/link"

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
import type { CategoriesResponse } from "@/hooks/Type"
import {
  fetchOwnerAgents,
  fetchOwnerProfile,
} from "@/lib/admin-client"
import type { OwnerAgentsResponse } from "@/lib/admin-types"
import { apiFetch } from "@/lib/api"
import { cn } from "@/lib/utils"

type OwnerProfileProps = {
  walletAddress: string
}

type OwnerAgentSort = "top_rank" | "newest" | "name"
type OwnerAgentStatus = "all" | "active" | "inactive"

const defaultCategories = [
  { slug: "all", name: "All Categories" },
  { slug: "finance", name: "Finance" },
  { slug: "tech", name: "Tech" },
  { slug: "crypto", name: "Crypto" },
  { slug: "sports", name: "Sports" },
]

const usdFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

export function OwnerProfile({ walletAddress }: OwnerProfileProps) {
  const [profile, setProfile] =
    React.useState<OwnerAgentsResponse["data"]["owner"] | null>(null)
  const [agentsResponse, setAgentsResponse] =
    React.useState<OwnerAgentsResponse | null>(null)
  const [categories, setCategories] = React.useState<
    Array<{ slug: string; name: string }>
  >(defaultCategories)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [category, setCategory] = React.useState("all")
  const [status, setStatus] = React.useState<OwnerAgentStatus>("all")
  const [sort, setSort] = React.useState<OwnerAgentSort>("top_rank")
  const [limit, setLimit] = React.useState("24")

  React.useEffect(() => {
    let active = true

    async function loadCategories() {
      try {
        const response = await apiFetch<CategoriesResponse>("/v1/categories", {
          method: "GET",
          auth: false,
        })

        if (!active || !response.data.length) {
          return
        }

        setCategories([
          { slug: "all", name: "All Categories" },
          ...response.data.map((item) => ({
            slug: item.slug,
            name: item.name,
          })),
        ])
      } catch {
        if (active) {
          setCategories(defaultCategories)
        }
      }
    }

    async function loadProfile() {
      setLoading(true)
      setError(null)

      try {
        const [ownerProfile, ownerAgents] = await Promise.all([
          fetchOwnerProfile(walletAddress),
          fetchOwnerAgents(walletAddress, {
            category: category !== "all" ? category : undefined,
            status: status !== "all" ? status : undefined,
            sort,
            limit: clampLimit(limit),
          }),
        ])

        if (!active) {
          return
        }

        setProfile(ownerProfile.data.owner)
        setAgentsResponse(ownerAgents)
      } catch (loadError) {
        if (!active) {
          return
        }

        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load owner profile"
        )
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void loadCategories()
    void loadProfile()

    return () => {
      active = false
    }
  }, [walletAddress, category, status, sort, limit])

  const agents = agentsResponse?.data.agents ?? []

  return (
    <div className="space-y-8">
      <Link
        href="/owners"
        className="inline-flex text-sm font-medium text-neutral-600 transition hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-neutral-50"
      >
        Back to owners
      </Link>

      <section className="overflow-hidden rounded-[2rem] bg-gradient-to-br from-emerald-50 via-white to-lime-50 p-6 ring-1 ring-black/5 dark:from-emerald-500/10 dark:via-neutral-950 dark:to-lime-500/10 dark:ring-white/10">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-end">
          <div>
            <p className="text-xs font-semibold tracking-[0.3em] text-emerald-700 uppercase dark:text-emerald-300">
              Owner Profile
            </p>
            <h1 className="mt-3 font-mono text-2xl font-semibold tracking-tight break-all md:text-3xl">
              {walletAddress}
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-neutral-600 dark:text-neutral-300">
              Owner-level roster, category coverage, and ranking context powered
              by `/v1/owners/:wallet` plus `/v1/owners/:wallet/agents`.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <ProfileMetric
              label="Agents"
              value={profile?.agent_count ?? agentsResponse?.data.summary.total_agents ?? 0}
            />
            <ProfileMetric
              label="Active"
              value={profile?.active_agents_count ?? 0}
            />
            <ProfileMetric
              label="Best Rank"
              value={profile?.best_rank ?? "Unranked"}
            />
            <ProfileMetric
              label="Resolved"
              value={profile?.stats.resolved_markets ?? 0}
            />
          </div>
        </div>
      </section>

      {loading && !profile ? (
        <Card>
          <CardContent className="p-6 text-sm text-neutral-500">
            Loading owner profile...
          </CardContent>
        </Card>
      ) : null}

      {error ? (
        <Card>
          <CardHeader>
            <CardTitle>Unable To Load Owner</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {profile ? (
        <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-6">
            <Card className="bg-white/80 dark:bg-white/5">
              <CardHeader>
                <CardTitle>Roster Filters</CardTitle>
                <CardDescription>
                  Narrow the owner roster by category, status, sort, and limit.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="grid gap-1.5">
                  <span className="text-xs font-medium text-neutral-500">
                    Category
                  </span>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {categories.map((item) => (
                          <SelectItem key={item.slug} value={item.slug}>
                            {item.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-1.5">
                  <span className="text-xs font-medium text-neutral-500">
                    Status
                  </span>
                  <Select
                    value={status}
                    onValueChange={(value) => setStatus(value as OwnerAgentStatus)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select status" />
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
                  <span className="text-xs font-medium text-neutral-500">
                    Sort
                  </span>
                  <Select
                    value={sort}
                    onValueChange={(value) => setSort(value as OwnerAgentSort)}
                  >
                    <SelectTrigger className="w-full">
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
                  <span className="text-xs font-medium text-neutral-500">
                    Limit
                  </span>
                  <Input
                    value={limit}
                    onChange={(event) => setLimit(event.target.value)}
                    inputMode="numeric"
                  />
                </div>
              </CardContent>
            </Card>

            <section className="grid gap-4 md:grid-cols-2">
              {agents.map((agent) => (
                <Card
                  key={agent.id}
                  className="bg-white/80 transition hover:-translate-y-0.5 hover:shadow-lg dark:bg-white/5"
                >
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <AgentAvatar name={agent.name} imageUri={agent.avatar_uri} />
                        <div className="min-w-0">
                          <CardTitle className="truncate text-base">
                            {agent.name}
                          </CardTitle>
                          <CardDescription>@{agent.slug}</CardDescription>
                        </div>
                      </div>
                      <Badge
                        variant={
                          agent.status === "active" ? "secondary" : "outline"
                        }
                        className="rounded"
                      >
                        {agent.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="line-clamp-3 min-h-14 text-sm leading-6 text-neutral-600 dark:text-neutral-300">
                      {agent.description}
                    </p>

                    <div className="flex flex-wrap gap-2">
                      {agent.categories.length ? (
                        agent.categories.map((item) => (
                          <Badge
                            key={`${agent.id}-${item.slug}`}
                            variant={item.is_primary ? "default" : "outline"}
                            className="rounded"
                          >
                            {item.name}
                          </Badge>
                        ))
                      ) : (
                        <Badge variant="outline" className="rounded">
                          Uncategorized
                        </Badge>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-3 rounded-2xl bg-neutral-950/[0.03] p-4 dark:bg-white/5">
                      <ProfileStat
                        label="Active Markets"
                        value={agent.activity.active_markets_count}
                      />
                      <ProfileStat label="Status" value={agent.status} />
                    </div>

                    <Button asChild className="w-full">
                      <Link href={`/agents/${agent.slug}`}>View Agent</Link>
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </section>

            {!loading && !agents.length ? (
              <Card>
                <CardHeader>
                  <CardTitle>No Agents Match These Filters</CardTitle>
                  <CardDescription>
                    Try relaxing the current category, status, or sort settings.
                  </CardDescription>
                </CardHeader>
              </Card>
            ) : null}
          </div>

          <div className="space-y-6">
            <Card className="bg-neutral-950 text-white ring-neutral-800 dark:bg-white dark:text-neutral-950">
              <CardHeader>
                <CardTitle>Owner Snapshot</CardTitle>
                <CardDescription className="text-neutral-400 dark:text-neutral-600">
                  High-level stats for this roster owner.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div>
                  <p className="text-neutral-400 dark:text-neutral-600">
                    Follower PnL
                  </p>
                  <p className="mt-1 text-lg font-semibold">
                    {formatUsd(profile.stats.follower_pnl_usdc)}
                  </p>
                </div>
                <div>
                  <p className="text-neutral-400 dark:text-neutral-600">
                    Total Staked
                  </p>
                  <p className="mt-1 text-lg font-semibold">
                    {formatUsd(profile.stats.total_staked_usdc)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {profile.categories.length ? (
                    profile.categories.map((item) => (
                      <Badge
                        key={`${profile.wallet_identity_id}-${item.slug}`}
                        variant="secondary"
                        className="rounded bg-white/10 text-white dark:bg-black/10 dark:text-neutral-950"
                      >
                        {item.name}
                      </Badge>
                    ))
                  ) : (
                    <Badge
                      variant="secondary"
                      className="rounded bg-white/10 text-white dark:bg-black/10 dark:text-neutral-950"
                    >
                      No categories yet
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>

            {profile.top_agent ? (
              <Card className="bg-white/80 dark:bg-white/5">
                <CardHeader>
                  <CardTitle>Top Agent</CardTitle>
                  <CardDescription>
                    Best-known ranked agent for this owner.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-3">
                    <AgentAvatar
                      name={profile.top_agent.name}
                      imageUri={profile.top_agent.avatar_uri}
                    />
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {profile.top_agent.name}
                      </p>
                      <p className="truncate text-sm text-neutral-500">
                        @{profile.top_agent.slug}
                      </p>
                    </div>
                  </div>
                  <div className="rounded-2xl bg-neutral-950/[0.03] p-4 text-sm dark:bg-white/5">
                    <p className="text-neutral-500">Leaderboard Rank</p>
                    <p className="mt-1 font-semibold">
                      {profile.top_agent.rank ? `#${profile.top_agent.rank}` : "Unranked"}
                    </p>
                  </div>
                  <Button asChild className="w-full">
                    <Link href={`/agents/${profile.top_agent.slug}`}>
                      Open Agent Profile
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  )
}

function ProfileMetric({
  label,
  value,
}: {
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="rounded-2xl bg-white/85 p-4 ring-1 ring-black/5 dark:bg-white/5 dark:ring-white/10">
      <p className="text-xs tracking-[0.16em] text-neutral-500 uppercase">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  )
}

function ProfileStat({
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
  imageUri,
  name,
}: {
  imageUri: string | null
  name: string
}) {
  if (imageUri) {
    return (
      <div
        aria-label={`${name} avatar`}
        className="size-12 shrink-0 rounded-2xl bg-cover bg-center ring-1 ring-black/10 dark:ring-white/10"
        style={{ backgroundImage: `url(${imageUri})` }}
      />
    )
  }

  return (
    <div
      className={cn(
        "flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-lime-200 to-cyan-200 text-sm font-semibold text-neutral-950 ring-1 ring-black/10"
      )}
    >
      {getInitials(name)}
    </div>
  )
}

function formatUsd(value: string) {
  const numericValue = Number(value)

  if (!Number.isFinite(numericValue)) {
    return value
  }

  return `$${usdFormatter.format(numericValue)}`
}

function getInitials(value: string) {
  return value
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("")
}

function clampLimit(value: string) {
  const numericValue = Number(value)

  if (!Number.isFinite(numericValue)) {
    return 24
  }

  return Math.max(1, Math.min(100, Math.round(numericValue)))
}
