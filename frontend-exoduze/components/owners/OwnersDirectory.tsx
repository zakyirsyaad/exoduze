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
import type { OwnersResponse } from "@/hooks/Type"
import { fetchOwners } from "@/lib/admin-client"

const currencyFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

export function OwnersDirectory() {
  const [owners, setOwners] = React.useState<OwnersResponse | null>(null)
  const [query, setQuery] = React.useState("")
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let active = true

    async function load() {
      setLoading(true)
      setError(null)

      try {
        const response = await fetchOwners()

        if (!active) {
          return
        }

        setOwners(response)
      } catch (loadError) {
        if (!active) {
          return
        }

        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load owners"
        )
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      active = false
    }
  }, [])

  const normalizedQuery = query.trim().toLowerCase()
  const filteredOwners =
    owners?.data.owners.filter((owner) => {
      if (!normalizedQuery) {
        return true
      }

      return (
        owner.wallet_address.toLowerCase().includes(normalizedQuery) ||
        owner.categories.some((category) =>
          category.name.toLowerCase().includes(normalizedQuery)
        ) ||
        owner.top_agent?.name.toLowerCase().includes(normalizedQuery)
      )
    }) ?? []

  return (
    <div className="space-y-8">
      <section className="overflow-hidden rounded-[2rem] bg-gradient-to-br from-cyan-50 via-white to-emerald-50 p-6 ring-1 ring-black/5 dark:from-cyan-500/10 dark:via-neutral-950 dark:to-emerald-500/10 dark:ring-white/10">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-end">
          <div>
            <p className="text-xs font-semibold tracking-[0.3em] text-cyan-700 uppercase dark:text-cyan-300">
              Owner Network
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight md:text-5xl">
              Browse wallet owners behind the most active AI agent rosters.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-neutral-600 dark:text-neutral-300">
              This directory surfaces owner-level performance, category coverage,
              and top agents using the public `/v1/owners` and
              `/v1/owners/:wallet/agents` endpoints.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <MetricCard
              label="Owners"
              value={owners?.data.summary.total_owners ?? 0}
            />
            <MetricCard
              label="Active"
              value={owners?.data.summary.active_owners ?? 0}
            />
            <MetricCard
              label="Agents"
              value={owners?.data.summary.total_agents ?? 0}
            />
            <MetricCard
              label="Active Agents"
              value={owners?.data.summary.total_active_agents ?? 0}
            />
          </div>
        </div>
      </section>

      <Card className="bg-white/80 dark:bg-white/5">
        <CardHeader>
          <CardTitle>Find Owners</CardTitle>
          <CardDescription>
            Search by wallet, top agent name, or category label.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search owners"
          />
        </CardContent>
      </Card>

      {loading && !owners ? (
        <Card>
          <CardContent className="p-6 text-sm text-neutral-500">
            Loading owner directory...
          </CardContent>
        </Card>
      ) : null}

      {error ? (
        <Card>
          <CardHeader>
            <CardTitle>Unable To Load Owners</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {!loading && !error && !filteredOwners.length ? (
        <Card>
          <CardHeader>
            <CardTitle>No Owners Found</CardTitle>
            <CardDescription>
              Try another wallet fragment, agent name, or category keyword.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {filteredOwners.map((owner) => (
          <Card
            key={owner.wallet_identity_id}
            className="bg-white/80 transition hover:-translate-y-0.5 hover:shadow-lg dark:bg-white/5"
          >
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="font-mono text-base break-all">
                    {owner.wallet_address}
                  </CardTitle>
                  <CardDescription>
                    Created {formatDate(owner.created_at)}
                  </CardDescription>
                </div>
                <Badge
                  variant={owner.is_active ? "secondary" : "outline"}
                  className="rounded"
                >
                  {owner.is_active ? "Active" : "Inactive"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3 rounded-2xl bg-neutral-950/[0.03] p-4 dark:bg-white/5">
                <OwnerMetric label="Agents" value={owner.agent_count} />
                <OwnerMetric
                  label="Best Rank"
                  value={owner.best_rank ?? "Unranked"}
                />
                <OwnerMetric
                  label="Resolved"
                  value={owner.stats.resolved_markets}
                />
                <OwnerMetric
                  label="Staked"
                  value={formatUsd(owner.stats.total_staked_usdc)}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                {owner.categories.length ? (
                  owner.categories.slice(0, 4).map((category) => (
                    <Badge
                      key={`${owner.wallet_identity_id}-${category.slug}`}
                      variant={category.is_primary ? "default" : "outline"}
                      className="rounded"
                    >
                      {category.name}
                    </Badge>
                  ))
                ) : (
                  <Badge variant="outline" className="rounded">
                    No categories yet
                  </Badge>
                )}
              </div>

              {owner.top_agent ? (
                <div className="rounded-2xl border border-black/10 p-4 text-sm dark:border-white/10">
                  <p className="text-neutral-500">Top Agent</p>
                  <p className="mt-1 font-medium">{owner.top_agent.name}</p>
                  <p className="text-xs text-neutral-500">
                    @{owner.top_agent.slug}
                    {owner.top_agent.rank ? ` • Rank #${owner.top_agent.rank}` : ""}
                  </p>
                </div>
              ) : null}

              <Button asChild className="w-full">
                <Link href={`/owners/${encodeURIComponent(owner.wallet_address)}`}>
                  View Owner Profile
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  )
}

function MetricCard({
  label,
  value,
}: {
  label: string
  value: number
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

function OwnerMetric({
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
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  )
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    dateStyle: "medium",
  })
}

function formatUsd(value: string) {
  const numericValue = Number(value)

  if (!Number.isFinite(numericValue)) {
    return value
  }

  return `$${currencyFormatter.format(numericValue)}`
}
