"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Add01Icon,
  DatabaseSyncIcon,
  Delete02Icon,
  Edit02Icon,
  ImageUploadIcon,
  RefreshIcon,
  Rocket01Icon,
} from "@hugeicons/core-free-icons"

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
import type {
  AdminMarketDisputesResponse,
  CategoriesResponse,
  HealthResponse,
  MarketsResponse,
  OwnersResponse,
} from "@/hooks/Type"
import { useAuth } from "@/hooks/useAuth"
import { ApiError, apiFetch } from "@/lib/api"
import { formatDisplayDateTime } from "@/lib/time-formatters"
import { cn } from "@/lib/utils"

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

type EndpointDefinition = {
  id: string
  group: string
  label: string
  method: HttpMethod
  path: string
  auth?: boolean
  body?: unknown
}

type RequestResult = {
  ok: boolean
  label: string
  payload: unknown
}

const marketBodyTemplate = {
  category: "finance",
  slug: "sample-market",
  title: "Sample market title",
  short_description: "Short market summary",
  description: "Full market description",
  image_uri: null,
  status: "draft",
  oracle_source: "manual",
  settlement_asset: "USDC",
  onchain_market_pubkey: null,
  opens_at: "2026-05-01T00:00:00.000Z",
  join_deadline_at: "2026-05-01T12:00:00.000Z",
  decision_cutoff_at: "2026-05-02T00:00:00.000Z",
  closes_at: "2026-05-03T00:00:00.000Z",
  resolves_at: null,
  total_liquidity_usdc: "0",
  final_liquidity_usdc: null,
  resolver_wallet: null,
  rules: ["Define what counts as YES.", "Define what counts as NO."],
  context: {
    source: "manual",
  },
  topic_slugs: ["sample-topic"],
}

const agentBodyTemplate = {
  slug: "sample-agent",
  name: "Sample Agent",
  description: "Agent profile description",
  status: "active",
  avatar_uri: null,
  category_slugs: ["finance"],
}

const endpointDefinitions: EndpointDefinition[] = [
  {
    id: "health",
    group: "System",
    label: "Health check",
    method: "GET",
    path: "/health",
    auth: false,
  },
  {
    id: "auth-challenge",
    group: "Auth",
    label: "Create wallet challenge",
    method: "POST",
    path: "/v1/auth/challenge",
    auth: false,
    body: { wallet_address: "" },
  },
  {
    id: "auth-verify",
    group: "Auth",
    label: "Verify wallet challenge",
    method: "POST",
    path: "/v1/auth/verify",
    auth: false,
    body: { challenge_id: "", wallet_address: "", signature: "" },
  },
  {
    id: "auth-me",
    group: "Auth",
    label: "Current session",
    method: "GET",
    path: "/v1/auth/me",
  },
  {
    id: "auth-logout",
    group: "Auth",
    label: "Logout session",
    method: "POST",
    path: "/v1/auth/logout",
  },
  {
    id: "categories",
    group: "Catalog",
    label: "List categories",
    method: "GET",
    path: "/v1/categories",
    auth: false,
  },
  {
    id: "category-page",
    group: "Catalog",
    label: "Category page",
    method: "GET",
    path: "/v1/categories/{categorySlug}",
    auth: false,
  },
  {
    id: "category-create",
    group: "Catalog",
    label: "Create category",
    method: "POST",
    path: "/v1/categories",
    body: {
      slug: "sample-category",
      name: "Sample Category",
      description: "Category description",
      sort_order: 0,
      is_active: true,
    },
  },
  {
    id: "category-replace",
    group: "Catalog",
    label: "Replace category",
    method: "PUT",
    path: "/v1/categories/{categoryIdOrSlug}",
    body: {
      slug: "sample-category",
      name: "Sample Category",
      description: "Category description",
      sort_order: 0,
      is_active: true,
    },
  },
  {
    id: "category-patch",
    group: "Catalog",
    label: "Patch category",
    method: "PATCH",
    path: "/v1/categories/{categoryIdOrSlug}",
    body: { name: "Updated Category" },
  },
  {
    id: "category-delete",
    group: "Catalog",
    label: "Delete category",
    method: "DELETE",
    path: "/v1/categories/{categoryIdOrSlug}",
  },
  {
    id: "topic-create",
    group: "Catalog",
    label: "Create topic",
    method: "POST",
    path: "/v1/topics",
    body: {
      category: "finance",
      slug: "sample-topic",
      name: "Sample Topic",
      description: "Topic description",
      is_active: true,
    },
  },
  {
    id: "topic-replace",
    group: "Catalog",
    label: "Replace topic",
    method: "PUT",
    path: "/v1/topics/{topicIdOrSlug}",
    body: {
      category: "finance",
      slug: "sample-topic",
      name: "Sample Topic",
      description: "Topic description",
      is_active: true,
    },
  },
  {
    id: "topic-patch",
    group: "Catalog",
    label: "Patch topic",
    method: "PATCH",
    path: "/v1/topics/{topicIdOrSlug}",
    body: { name: "Updated Topic" },
  },
  {
    id: "topic-delete",
    group: "Catalog",
    label: "Delete topic",
    method: "DELETE",
    path: "/v1/topics/{topicIdOrSlug}",
  },
  {
    id: "markets",
    group: "Markets",
    label: "List markets",
    method: "GET",
    path: "/v1/markets",
    auth: false,
  },
  {
    id: "market-create",
    group: "Markets",
    label: "Create market",
    method: "POST",
    path: "/v1/markets",
    body: marketBodyTemplate,
  },
  {
    id: "market-detail",
    group: "Markets",
    label: "Market detail",
    method: "GET",
    path: "/v1/markets/{marketIdOrSlug}",
    auth: false,
  },
  {
    id: "market-replace",
    group: "Markets",
    label: "Replace market",
    method: "PUT",
    path: "/v1/markets/{marketIdOrSlug}",
    body: marketBodyTemplate,
  },
  {
    id: "market-patch",
    group: "Markets",
    label: "Patch market",
    method: "PATCH",
    path: "/v1/markets/{marketIdOrSlug}",
    body: { image_uri: "https://example.com/market.jpg" },
  },
  {
    id: "market-delete",
    group: "Markets",
    label: "Delete market",
    method: "DELETE",
    path: "/v1/markets/{marketIdOrSlug}",
  },
  {
    id: "market-news",
    group: "Markets",
    label: "Market news",
    method: "GET",
    path: "/v1/markets/{marketIdOrSlug}/news",
    auth: false,
  },
  {
    id: "market-onchain",
    group: "Markets",
    label: "Publish market onchain",
    method: "POST",
    path: "/v1/markets/{marketIdOrSlug}/onchain",
  },
  {
    id: "market-resolve",
    group: "Markets",
    label: "Resolve market",
    method: "POST",
    path: "/v1/markets/{marketIdOrSlug}/resolve",
    body: {
      outcome: "YES",
      evidence_uri: null,
      submitted_tx_sig: null,
    },
  },
  {
    id: "market-join",
    group: "Markets",
    label: "Join market as agent",
    method: "POST",
    path: "/v1/markets/{marketIdOrSlug}/agents/{agentIdOrSlug}/join",
    body: { user_prompt: null },
  },
  {
    id: "market-stake",
    group: "Markets",
    label: "Record stake confirmation",
    method: "POST",
    path: "/v1/markets/{marketIdOrSlug}/agents/{agentIdOrSlug}/stake",
    body: {
      commit_included: true,
      market_agent_id: null,
      onchain_commitment_ref: "",
      onchain_position_ref: "",
      stake_amount_base_units: "1000000",
      stake_usdc: "1",
      tx_sig: null,
      user_token_account: null,
      vault_pubkey: null,
    },
  },
  {
    id: "market-snapshot",
    group: "Markets",
    label: "Agent snapshot",
    method: "GET",
    path: "/v1/markets/{marketIdOrSlug}/agents/{marketAgentId}/snapshot",
    auth: false,
  },
  {
    id: "feed-live",
    group: "Feed",
    label: "Live feed",
    method: "GET",
    path: "/v1/feed/live?limit=10",
    auth: false,
  },
  {
    id: "feed-hot",
    group: "Feed",
    label: "Hot topics",
    method: "GET",
    path: "/v1/feed/hot-topics?limit=10",
    auth: false,
  },
  {
    id: "feed-refresh",
    group: "Feed",
    label: "Refresh feed",
    method: "POST",
    path: "/v1/feed/refresh",
    body: { force: true },
  },
  {
    id: "agents",
    group: "Agents",
    label: "List agents",
    method: "GET",
    path: "/v1/agents?limit=20",
    auth: false,
  },
  {
    id: "agent-create",
    group: "Agents",
    label: "Create agent",
    method: "POST",
    path: "/v1/agents",
    body: agentBodyTemplate,
  },
  {
    id: "agent-hof",
    group: "Agents",
    label: "Hall of fame",
    method: "GET",
    path: "/v1/agents/hall-of-fame?window=all_time&limit=10",
    auth: false,
  },
  {
    id: "agent-replace",
    group: "Agents",
    label: "Replace agent",
    method: "PUT",
    path: "/v1/agents/{agentIdOrSlug}",
    body: agentBodyTemplate,
  },
  {
    id: "agent-patch",
    group: "Agents",
    label: "Patch agent",
    method: "PATCH",
    path: "/v1/agents/{agentIdOrSlug}",
    body: { status: "inactive" },
  },
  {
    id: "agent-delete",
    group: "Agents",
    label: "Delete agent",
    method: "DELETE",
    path: "/v1/agents/{agentIdOrSlug}",
  },
  {
    id: "owners",
    group: "Owners",
    label: "List owners",
    method: "GET",
    path: "/v1/owners",
    auth: false,
  },
  {
    id: "owner-profile",
    group: "Owners",
    label: "Owner profile",
    method: "GET",
    path: "/v1/owners/{walletAddress}",
    auth: false,
  },
  {
    id: "owner-agents",
    group: "Owners",
    label: "Owner agents",
    method: "GET",
    path: "/v1/owners/{walletAddress}/agents?limit=20",
    auth: false,
  },
  {
    id: "market-dispute",
    group: "Markets",
    label: "Dispute proposed resolution",
    method: "POST",
    path: "/v1/markets/{marketIdOrSlug}/resolutions/{resolutionId}/dispute",
    body: { reason: "Snapshot evidence appears to use the wrong topic rank." },
  },
  {
    id: "admin-disputes",
    group: "Markets",
    label: "List open disputes",
    method: "GET",
    path: "/v1/admin/market-disputes",
  },
  {
    id: "admin-dispute-accept",
    group: "Markets",
    label: "Accept dispute",
    method: "POST",
    path: "/v1/admin/market-disputes/{disputeId}/accept",
    body: { final_outcome: "YES" },
  },
  {
    id: "admin-dispute-reject",
    group: "Markets",
    label: "Reject dispute",
    method: "POST",
    path: "/v1/admin/market-disputes/{disputeId}/reject",
  },
  {
    id: "portfolio",
    group: "Portfolio",
    label: "Wallet portfolio",
    method: "GET",
    path: "/v1/portfolio/{walletAddress}",
  },
]

const methodTone: Record<HttpMethod, string> = {
  GET: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  POST: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  PUT: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  PATCH:
    "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  DELETE: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
}

const formatBody = (value: unknown) =>
  value === undefined ? "" : JSON.stringify(value, null, 2)

const formatPayload = (value: unknown) => JSON.stringify(value, null, 2)

export function OpsDashboard() {
  const auth = useAuth()
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [categories, setCategories] = useState<CategoriesResponse | null>(null)
  const [markets, setMarkets] = useState<MarketsResponse | null>(null)
  const [owners, setOwners] = useState<OwnersResponse | null>(null)
  const [disputes, setDisputes] =
    useState<AdminMarketDisputesResponse | null>(null)
  const [overviewLoading, setOverviewLoading] = useState(false)
  const [overviewError, setOverviewError] = useState<string | null>(null)
  const [feedCategory, setFeedCategory] = useState("")
  const [selectedEndpointId, setSelectedEndpointId] = useState(
    endpointDefinitions[0].id
  )
  const selectedEndpoint = useMemo(
    () =>
      endpointDefinitions.find(
        (endpoint) => endpoint.id === selectedEndpointId
      ) ?? endpointDefinitions[0],
    [selectedEndpointId]
  )
  const [pathValue, setPathValue] = useState(selectedEndpoint.path)
  const [bodyValue, setBodyValue] = useState(formatBody(selectedEndpoint.body))
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<RequestResult | null>(null)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)

  const refreshOverview = useCallback(async () => {
    setOverviewLoading(true)
    setOverviewError(null)

    const [
      healthResult,
      categoriesResult,
      marketsResult,
      ownersResult,
      disputesResult,
    ] =
      await Promise.allSettled([
        apiFetch<HealthResponse>("/health", { method: "GET", auth: false }),
        apiFetch<CategoriesResponse>("/v1/categories", {
          method: "GET",
          auth: false,
        }),
        apiFetch<MarketsResponse>("/v1/markets", {
          method: "GET",
          auth: false,
        }),
        apiFetch<OwnersResponse>("/v1/owners", {
          method: "GET",
          auth: false,
        }),
        auth.isAdmin
          ? apiFetch<AdminMarketDisputesResponse>("/v1/admin/market-disputes", {
              method: "GET",
            })
          : Promise.resolve(null),
      ])

    if (healthResult.status === "fulfilled") {
      setHealth(healthResult.value)
    }

    if (categoriesResult.status === "fulfilled") {
      setCategories(categoriesResult.value)
    }

    if (marketsResult.status === "fulfilled") {
      setMarkets(marketsResult.value)
    }

    if (ownersResult.status === "fulfilled") {
      setOwners(ownersResult.value)
    }

    if (disputesResult.status === "fulfilled") {
      setDisputes(disputesResult.value)
    }

    const failed = [
      healthResult,
      categoriesResult,
      marketsResult,
      ownersResult,
      disputesResult,
    ].find((entry) => entry.status === "rejected")

    if (failed?.status === "rejected") {
      setOverviewError(
        failed.reason instanceof Error
          ? failed.reason.message
          : "Unable to load overview"
      )
    }

    setOverviewLoading(false)
  }, [auth.isAdmin])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void refreshOverview()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [refreshOverview])

  const handleEndpointChange = (endpointId: string) => {
    const endpoint =
      endpointDefinitions.find((item) => item.id === endpointId) ??
      endpointDefinitions[0]

    setSelectedEndpointId(endpoint.id)
    setPathValue(endpoint.path)
    setBodyValue(formatBody(endpoint.body))
  }

  const runEndpoint = async () => {
    setRunning(true)
    setResult(null)

    try {
      const trimmedBody = bodyValue.trim()
      const requestBody =
        selectedEndpoint.method === "GET" ||
          selectedEndpoint.method === "DELETE" ||
          !trimmedBody
          ? undefined
          : JSON.stringify(JSON.parse(trimmedBody))

      const payload = await apiFetch<unknown>(pathValue, {
        method: selectedEndpoint.method,
        auth: selectedEndpoint.auth ?? true,
        ...(requestBody ? { body: requestBody } : {}),
      })

      setResult({
        ok: true,
        label: `${selectedEndpoint.method} ${pathValue}`,
        payload,
      })
      void refreshOverview()
    } catch (error) {
      setResult({
        ok: false,
        label: `${selectedEndpoint.method} ${pathValue}`,
        payload:
          error instanceof ApiError
            ? {
              status: error.status,
              message: error.message,
              payload: error.payload,
            }
            : error instanceof Error
              ? { message: error.message }
              : { message: "Request failed" },
      })
    } finally {
      setRunning(false)
    }
  }

  const refreshFeed = async () => {
    setRunning(true)
    setResult(null)

    try {
      const payload = await apiFetch<unknown>("/v1/feed/refresh", {
        method: "POST",
        body: JSON.stringify({
          force: true,
          ...(feedCategory.trim() ? { category: feedCategory.trim() } : {}),
        }),
      })

      setResult({
        ok: true,
        label: "POST /v1/feed/refresh",
        payload,
      })
    } catch (error) {
      setResult({
        ok: false,
        label: "POST /v1/feed/refresh",
        payload:
          error instanceof Error
            ? { message: error.message }
            : { message: "Request failed" },
      })
    } finally {
      setRunning(false)
    }
  }

  const resolveDispute = async (
    disputeId: string,
    action: "accept_yes" | "accept_no" | "reject"
  ) => {
    setRunning(true)
    setResult(null)

    const path =
      action === "reject"
        ? `/v1/admin/market-disputes/${encodeURIComponent(disputeId)}/reject`
        : `/v1/admin/market-disputes/${encodeURIComponent(disputeId)}/accept`
    const body =
      action === "reject"
        ? undefined
        : JSON.stringify({
            final_outcome: action === "accept_yes" ? "YES" : "NO",
          })

    try {
      const payload = await apiFetch<unknown>(path, {
        method: "POST",
        ...(body ? { body } : {}),
      })

      setResult({
        ok: true,
        label: `POST ${path}`,
        payload,
      })
      void refreshOverview()
    } catch (error) {
      setResult({
        ok: false,
        label: `POST ${path}`,
        payload:
          error instanceof Error
            ? { message: error.message }
            : { message: "Request failed" },
      })
    } finally {
      setRunning(false)
    }
  }

  const uploadAvatar = async () => {
    if (!avatarFile) {
      setResult({
        ok: false,
        label: "POST /v1/uploads/agent-avatar",
        payload: { message: "Choose an avatar file first" },
      })
      return
    }

    setRunning(true)
    setResult(null)

    try {
      const formData = new FormData()
      formData.append("file", avatarFile)

      const payload = await apiFetch<unknown>("/v1/uploads/agent-avatar", {
        method: "POST",
        body: formData,
      })

      setResult({
        ok: true,
        label: "POST /v1/uploads/agent-avatar",
        payload,
      })
    } catch (error) {
      setResult({
        ok: false,
        label: "POST /v1/uploads/agent-avatar",
        payload:
          error instanceof Error
            ? { message: error.message }
            : { message: "Upload failed" },
      })
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-8">
      <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium text-neutral-500 uppercase">
            Backend Ops
          </p>
          <h1 className="mt-2 text-3xl font-semibold">Endpoint Console</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant={auth.isAuthenticated ? "secondary" : "outline"}>
            {auth.isAuthenticated ? "Wallet connected" : "Guest"}
          </Badge>
          <Badge variant={auth.isAdmin ? "secondary" : "outline"}>
            {auth.isAdmin ? "Admin" : "Non-admin"}
          </Badge>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <MetricCard
          label="Health"
          value={health?.ok ? "OK" : "Unknown"}
          detail={health?.service ?? "Backend"}
        />
        <MetricCard
          label="Categories"
          value={categories?.data.length ?? 0}
          detail="GET /v1/categories"
        />
        <MetricCard
          label="Markets"
          value={markets?.data.length ?? 0}
          detail="GET /v1/markets"
        />
        <MetricCard
          label="Owners"
          value={owners?.data.summary.total_owners ?? 0}
          detail="GET /v1/owners"
        />
      </section>

      {overviewError ? (
        <p className="text-sm text-red-500">{overviewError}</p>
      ) : null}

      {auth.isAdmin && disputes?.data.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Disputed Markets</CardTitle>
            <CardDescription>
              Admin fallback for disputed oracle proposals.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {disputes.data.map((dispute) => (
              <article
                key={dispute.id}
                className="grid gap-3 rounded border border-black/10 p-3 text-sm dark:border-white/10"
              >
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="font-medium">{dispute.market.title}</p>
                    <p className="text-neutral-500">
                      Oracle proposed {dispute.resolution.proposed_outcome}
                    </p>
                  </div>
                  <Badge variant="outline" className="rounded">
                    {dispute.status}
                  </Badge>
                </div>
                <p className="text-neutral-600 dark:text-neutral-300">
                  {dispute.reason}
                </p>
                <p className="text-neutral-500">
                  {dispute.resolution.evidence_summary}
                </p>
                <div className="grid gap-1 text-xs text-neutral-500 md:grid-cols-2">
                  <p>
                    Snapshot generated{" "}
                    {formatDisplayDateTime(
                      dispute.resolution.evidence_snapshot_generated_at
                    )}
                  </p>
                  <p>
                    Dispute deadline{" "}
                    {formatDisplayDateTime(dispute.resolution.dispute_deadline)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => void resolveDispute(dispute.id, "accept_yes")}
                    disabled={running}
                  >
                    Finalize YES
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void resolveDispute(dispute.id, "accept_no")}
                    disabled={running}
                  >
                    Finalize NO
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void resolveDispute(dispute.id, "reject")}
                    disabled={running}
                  >
                    Keep Oracle Result
                  </Button>
                </div>
              </article>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader>
            <CardTitle>Request Runner</CardTitle>
            <CardDescription>Backend routes grouped by domain.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-[280px_1fr]">
              <label className="grid gap-1 text-sm">
                <span className="text-neutral-500">Endpoint</span>
                <select
                  value={selectedEndpointId}
                  onChange={(event) => handleEndpointChange(event.target.value)}
                  className="h-8 rounded-md border border-input bg-input/20 px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30"
                >
                  {endpointDefinitions.map((endpoint) => (
                    <option key={endpoint.id} value={endpoint.id}>
                      {endpoint.group} - {endpoint.method} {endpoint.path}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1 text-sm">
                <span className="text-neutral-500">Path</span>
                <Input
                  value={pathValue}
                  onChange={(event) => setPathValue(event.target.value)}
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "rounded px-2 py-1 text-xs font-semibold",
                  methodTone[selectedEndpoint.method]
                )}
              >
                {selectedEndpoint.method}
              </span>
              <span className="text-sm text-neutral-500">
                {selectedEndpoint.label}
              </span>
            </div>

            <label className="grid gap-1 text-sm">
              <span className="text-neutral-500">JSON Body</span>
              <textarea
                value={bodyValue}
                onChange={(event) => setBodyValue(event.target.value)}
                className="min-h-64 rounded-md border border-input bg-input/20 p-3 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30"
                spellCheck={false}
              />
            </label>

            <div className="flex flex-wrap gap-2">
              <Button onClick={runEndpoint} disabled={running}>
                <HugeiconsIcon icon={DatabaseSyncIcon} strokeWidth={2} />
                Run Endpoint
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setPathValue(selectedEndpoint.path)
                  setBodyValue(formatBody(selectedEndpoint.body))
                }}
              >
                <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} />
                Reset
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
              <CardDescription>Session-scoped admin calls.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-2">
                <label className="text-sm text-neutral-500">
                  Feed category
                </label>
                <Input
                  value={feedCategory}
                  onChange={(event) => setFeedCategory(event.target.value)}
                  placeholder="optional category slug"
                />
                <Button onClick={refreshFeed} disabled={running}>
                  <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} />
                  Refresh Feed
                </Button>
              </div>

              <div className="grid gap-2">
                <label className="text-sm text-neutral-500">Agent avatar</label>
                <Input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  onChange={(event) =>
                    setAvatarFile(event.target.files?.[0] ?? null)
                  }
                />
                <Button
                  variant="outline"
                  onClick={uploadAvatar}
                  disabled={running}
                >
                  <HugeiconsIcon icon={ImageUploadIcon} strokeWidth={2} />
                  Upload Avatar
                </Button>
              </div>

              <div className="grid gap-2 text-sm text-neutral-500">
                <EndpointHint icon={Add01Icon} label="POST endpoints create" />
                <EndpointHint
                  icon={Edit02Icon}
                  label="PUT/PATCH endpoints edit"
                />
                <EndpointHint
                  icon={Delete02Icon}
                  label="DELETE endpoints archive"
                />
                <EndpointHint
                  icon={Rocket01Icon}
                  label="Onchain publish is admin-only"
                />
              </div>
            </CardContent>
          </Card>

          <Card className="min-h-96">
            <CardHeader>
              <CardTitle>Response</CardTitle>
              <CardDescription>Latest endpoint payload.</CardDescription>
            </CardHeader>
            <CardContent>
              {result ? (
                <div className="grid gap-3">
                  <Badge variant={result.ok ? "secondary" : "destructive"}>
                    {result.ok ? "Success" : "Failed"} - {result.label}
                  </Badge>
                  <pre className="max-h-[520px] overflow-auto rounded-md bg-neutral-950 p-3 text-xs text-neutral-50">
                    {formatPayload(result.payload)}
                  </pre>
                </div>
              ) : (
                <p className="text-sm text-neutral-500">
                  {overviewLoading ? "Loading overview..." : "No request yet."}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  )
}

function MetricCard({
  label,
  value,
  detail,
}: {
  label: string
  value: string | number
  detail: string
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-neutral-500">{detail}</CardContent>
    </Card>
  )
}

function EndpointHint({
  icon,
  label,
}: {
  icon: Parameters<typeof HugeiconsIcon>[0]["icon"]
  label: string
}) {
  return (
    <div className="flex items-center gap-2">
      <HugeiconsIcon icon={icon} strokeWidth={2} className="size-4" />
      <span>{label}</span>
    </div>
  )
}
