"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"

import { AdminGate } from "@/components/admin/AdminShell"
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
import type { MarketDetailResponse, MarketStatus } from "@/hooks/Type"
import {
  createMarket,
  deleteMarket,
  fetchCatalogIndex,
  fetchMarketDetail,
  fetchMarkets,
  publishMarketOnchain,
  replaceMarket,
  resolveMarket,
} from "@/lib/admin-client"
import type { CatalogIndex, MarketMutationInput } from "@/lib/admin-types"
import { formatDisplayDateTime } from "@/lib/time-formatters"

type MarketFormState = {
  target: string
  category: string
  slug: string
  title: string
  short_description: string
  description: string
  image_uri: string
  status: MarketStatus
  oracle_source: string
  settlement_asset: string
  onchain_market_pubkey: string
  opens_at: string
  join_deadline_at: string
  decision_cutoff_at: string
  closes_at: string
  resolves_at: string
  total_liquidity_usdc: string
  final_liquidity_usdc: string
  resolver_wallet: string
  rules_text: string
  context_text: string
  topic_slugs: string[]
}

type ResolveFormState = {
  outcome: "YES" | "NO"
  evidence_uri: string
  submitted_tx_sig: string
  resolved_at: string
}

const marketStatuses: MarketStatus[] = [
  "draft",
  "upcoming",
  "open",
  "locked",
  "closed",
  "resolving",
  "disputed",
  "resolved",
  "cancelled",
]

const defaultResolveForm: ResolveFormState = {
  outcome: "YES",
  evidence_uri: "",
  submitted_tx_sig: "",
  resolved_at: "",
}

const buildDefaultMarketForm = (
  category = "",
  topicSlugs: string[] = []
): MarketFormState => ({
  target: "",
  category,
  slug: "",
  title: "",
  short_description: "",
  description: "",
  image_uri: "",
  status: "draft",
  oracle_source: "manual",
  settlement_asset: "USDC",
  onchain_market_pubkey: "",
  opens_at: "",
  join_deadline_at: "",
  decision_cutoff_at: "",
  closes_at: "",
  resolves_at: "",
  total_liquidity_usdc: "0",
  final_liquidity_usdc: "",
  resolver_wallet: "",
  rules_text: "Define what counts as YES.\nDefine what counts as NO.",
  context_text: "{\n  \"source\": \"manual\"\n}",
  topic_slugs: topicSlugs,
})

export function MarketsAdminPage() {
  const [catalog, setCatalog] = React.useState<CatalogIndex | null>(null)
  const [markets, setMarkets] =
    React.useState<Awaited<ReturnType<typeof fetchMarkets>> | null>(null)
  const [selectedMarket, setSelectedMarket] =
    React.useState<MarketDetailResponse | null>(null)
  const [marketForm, setMarketForm] = React.useState<MarketFormState>(
    buildDefaultMarketForm()
  )
  const [resolveForm, setResolveForm] =
    React.useState<ResolveFormState>(defaultResolveForm)
  const [loading, setLoading] = React.useState(true)
  const [working, setWorking] = React.useState(false)
  const [detailLoading, setDetailLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [search, setSearch] = React.useState("")

  const loadBootstrap = React.useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const [catalogResponse, marketsResponse] = await Promise.all([
        fetchCatalogIndex(),
        fetchMarkets(),
      ])

      setCatalog(catalogResponse)
      setMarkets(marketsResponse)
      setMarketForm((current) =>
        current.category
          ? current
          : buildDefaultMarketForm(
              catalogResponse.categories[0]?.slug ?? "",
              catalogResponse.topics
                .filter(
                  (topic) =>
                    topic.category.slug === catalogResponse.categories[0]?.slug
                )
                .slice(0, 1)
                .map((topic) => topic.slug)
            )
      )
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load admin markets"
      )
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadBootstrap()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [loadBootstrap])

  const visibleMarkets = React.useMemo(() => {
    const items = markets?.data ?? []
    const normalizedSearch = search.trim().toLowerCase()

    if (!normalizedSearch) {
      return items
    }

    return items.filter((market) => {
      return (
        market.title.toLowerCase().includes(normalizedSearch) ||
        market.slug.toLowerCase().includes(normalizedSearch) ||
        market.category.name.toLowerCase().includes(normalizedSearch)
      )
    })
  }, [markets, search])

  const availableTopics = React.useMemo(
    () =>
      catalog?.topics.filter(
        (topic) => topic.category.slug === marketForm.category
      ) ?? [],
    [catalog, marketForm.category]
  )

  async function handleSelectMarket(target: string) {
    setDetailLoading(true)

    try {
      const response = await fetchMarketDetail(target)
      setSelectedMarket(response)
      setMarketForm(mapMarketDetailToForm(response))
      setResolveForm(defaultResolveForm)
    } catch (loadError) {
      toast.error(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load market detail"
      )
    } finally {
      setDetailLoading(false)
    }
  }

  async function handleSaveMarket() {
    if (
      !marketForm.category.trim() ||
      !marketForm.title.trim() ||
      !marketForm.short_description.trim() ||
      !marketForm.description.trim() ||
      !marketForm.opens_at ||
      !marketForm.decision_cutoff_at ||
      !marketForm.closes_at ||
      !marketForm.topic_slugs.length
    ) {
      toast.error("Please complete the required market fields first")
      return
    }

    setWorking(true)

    try {
      const payload = buildMarketPayload(marketForm)
      const response = marketForm.target.trim()
        ? await replaceMarket(marketForm.target.trim(), payload)
        : await createMarket(payload)

      setSelectedMarket(response)
      setMarketForm(mapMarketDetailToForm(response))
      await loadBootstrap()
      toast.success(marketForm.target ? "Market updated" : "Market created")
    } catch (saveError) {
      toast.error(
        saveError instanceof Error ? saveError.message : "Unable to save market"
      )
    } finally {
      setWorking(false)
    }
  }

  async function handleDeleteMarket() {
    if (!marketForm.target.trim()) {
      toast.error("Select a market before deleting it")
      return
    }

    setWorking(true)

    try {
      await deleteMarket(marketForm.target.trim())
      toast.success("Market cancelled")
      resetMarketForm()
      setSelectedMarket(null)
      await loadBootstrap()
    } catch (deleteError) {
      toast.error(
        deleteError instanceof Error
          ? deleteError.message
          : "Unable to cancel market"
      )
    } finally {
      setWorking(false)
    }
  }

  async function handlePublishOnchain() {
    if (!marketForm.target.trim()) {
      toast.error("Select a market before publishing it on-chain")
      return
    }

    setWorking(true)

    try {
      const response = await publishMarketOnchain(marketForm.target.trim())
      setSelectedMarket(response)
      setMarketForm(mapMarketDetailToForm(response))
      await loadBootstrap()
      toast.success("On-chain publish completed")
    } catch (publishError) {
      toast.error(
        publishError instanceof Error
          ? publishError.message
          : "Unable to publish market on-chain"
      )
    } finally {
      setWorking(false)
    }
  }

  async function handleResolveMarket() {
    if (!marketForm.target.trim()) {
      toast.error("Select a market before resolving it")
      return
    }

    setWorking(true)

    try {
      const response = await resolveMarket(marketForm.target.trim(), {
        outcome: resolveForm.outcome,
        evidence_uri: normalizeNullableText(resolveForm.evidence_uri),
        submitted_tx_sig: normalizeNullableText(resolveForm.submitted_tx_sig),
        resolved_at: normalizeIsoValue(resolveForm.resolved_at),
      })

      setSelectedMarket(response)
      setMarketForm(mapMarketDetailToForm(response))
      await loadBootstrap()
      toast.success("Market resolved")
    } catch (resolveError) {
      toast.error(
        resolveError instanceof Error
          ? resolveError.message
          : "Unable to resolve market"
      )
    } finally {
      setWorking(false)
    }
  }

  function resetMarketForm() {
    const firstCategory = catalog?.categories[0]?.slug ?? ""
    const firstTopics =
      catalog?.topics
        .filter((topic) => topic.category.slug === firstCategory)
        .slice(0, 1)
        .map((topic) => topic.slug) ?? []

    setMarketForm(buildDefaultMarketForm(firstCategory, firstTopics))
    setResolveForm(defaultResolveForm)
  }

  return (
    <AdminGate>
      <div className="space-y-6">
        <Card className="bg-white/80 dark:bg-white/5">
          <CardHeader>
            <CardTitle>Market Lifecycle Admin</CardTitle>
            <CardDescription>
              Create, replace, cancel, publish on-chain, and resolve markets
              using focused UI on top of the market admin endpoints.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button onClick={() => void handleSaveMarket()} disabled={working}>
              {marketForm.target ? "Save Market" : "Create Market"}
            </Button>
            <Button variant="outline" onClick={resetMarketForm}>
              New Draft
            </Button>
            <Button
              variant="outline"
              onClick={() => void handlePublishOnchain()}
              disabled={working}
            >
              Publish On-chain
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleDeleteMarket()}
              disabled={working}
            >
              Cancel Market
            </Button>
          </CardContent>
        </Card>

        {loading ? (
          <Card>
            <CardContent className="p-6 text-sm text-neutral-500">
              Loading markets and catalog metadata...
            </CardContent>
          </Card>
        ) : null}

        {error ? (
          <Card>
            <CardHeader>
              <CardTitle>Unable To Load Market Admin</CardTitle>
              <CardDescription>{error}</CardDescription>
            </CardHeader>
          </Card>
        ) : null}

        <section className="grid gap-6 2xl:grid-cols-[420px_minmax(0,1fr)]">
          <div className="space-y-4">
            <Card className="bg-white/80 dark:bg-white/5">
              <CardHeader>
                <CardTitle>Market List</CardTitle>
                <CardDescription>
                  Search and select a market to manage.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by title, slug, or category"
                />
                <div className="grid gap-3">
                  {visibleMarkets.length ? (
                    visibleMarkets.map((market) => (
                      <button
                        key={market.id}
                        type="button"
                        onClick={() => void handleSelectMarket(market.slug)}
                        className="rounded-2xl border border-black/10 p-4 text-left transition hover:bg-secondary/70 dark:border-white/10 dark:hover:bg-white/5"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate font-medium">{market.title}</p>
                            <p className="truncate text-xs text-neutral-500">
                              {market.slug}
                            </p>
                          </div>
                          <Badge variant="outline" className="rounded">
                            {market.status}
                          </Badge>
                        </div>
                        <div className="mt-3 grid gap-1 text-xs text-neutral-500">
                          <span>{market.category.name}</span>
                          <span>
                            Opens {formatDisplayDateTime(market.timing.opens_at)}
                          </span>
                          <span>
                            Liquidity {market.liquidity.total_liquidity_usdc}{" "}
                            {market.liquidity.settlement_asset}
                          </span>
                        </div>
                      </button>
                    ))
                  ) : (
                    <p className="text-sm text-neutral-500">No markets found.</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="bg-white/80 dark:bg-white/5">
              <CardHeader>
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <CardTitle>Market Editor</CardTitle>
                    <CardDescription>
                      {marketForm.target
                        ? "Editing an existing market."
                        : "Preparing a new market draft."}
                    </CardDescription>
                  </div>
                  {detailLoading ? (
                    <Badge variant="outline" className="w-fit rounded">
                      Loading detail...
                    </Badge>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent className="grid gap-4">
                <section className="grid gap-3 md:grid-cols-2">
                  <TextField
                    label="Target slug or id"
                    value={marketForm.target}
                    onChange={(value) =>
                      setMarketForm((current) => ({
                        ...current,
                        target: value,
                      }))
                    }
                    placeholder="Leave empty to create"
                  />
                  <TextField
                    label="Slug"
                    value={marketForm.slug}
                    onChange={(value) =>
                      setMarketForm((current) => ({
                        ...current,
                        slug: value,
                      }))
                    }
                    placeholder="auto-generated if empty"
                  />
                  <SelectField
                    label="Category"
                    value={marketForm.category}
                    onChange={(value) =>
                      setMarketForm((current) => ({
                        ...current,
                        category: value,
                        topic_slugs: [],
                      }))
                    }
                    options={catalog?.categories.map((category) => ({
                      label: category.name,
                      value: category.slug,
                    })) ?? []}
                  />
                  <SelectField
                    label="Status"
                    value={marketForm.status}
                    onChange={(value) =>
                      setMarketForm((current) => ({
                        ...current,
                        status: value as MarketStatus,
                      }))
                    }
                    options={marketStatuses.map((status) => ({
                      label: formatStatus(status),
                      value: status,
                    }))}
                  />
                  <TextField
                    label="Title"
                    value={marketForm.title}
                    onChange={(value) =>
                      setMarketForm((current) => ({
                        ...current,
                        title: value,
                      }))
                    }
                  />
                  <TextField
                    label="Short Description"
                    value={marketForm.short_description}
                    onChange={(value) =>
                      setMarketForm((current) => ({
                        ...current,
                        short_description: value,
                      }))
                    }
                  />
                  <TextField
                    label="Image URL"
                    value={marketForm.image_uri}
                    onChange={(value) =>
                      setMarketForm((current) => ({
                        ...current,
                        image_uri: value,
                      }))
                    }
                    placeholder="https://..."
                  />
                  <TextField
                    label="Oracle Source"
                    value={marketForm.oracle_source}
                    onChange={(value) =>
                      setMarketForm((current) => ({
                        ...current,
                        oracle_source: value,
                      }))
                    }
                  />
                  <TextField
                    label="Settlement Asset"
                    value={marketForm.settlement_asset}
                    onChange={(value) =>
                      setMarketForm((current) => ({
                        ...current,
                        settlement_asset: value,
                      }))
                    }
                  />
                  <TextField
                    label="Resolver Wallet"
                    value={marketForm.resolver_wallet}
                    onChange={(value) =>
                      setMarketForm((current) => ({
                        ...current,
                        resolver_wallet: value,
                      }))
                    }
                    placeholder="optional wallet address"
                  />
                  <TextField
                    label="On-chain Market Pubkey"
                    value={marketForm.onchain_market_pubkey}
                    onChange={(value) =>
                      setMarketForm((current) => ({
                        ...current,
                        onchain_market_pubkey: value,
                      }))
                    }
                    placeholder="optional existing pubkey"
                  />
                  <TextField
                    label="Total Liquidity (USDC)"
                    value={marketForm.total_liquidity_usdc}
                    onChange={(value) =>
                      setMarketForm((current) => ({
                        ...current,
                        total_liquidity_usdc: value,
                      }))
                    }
                  />
                  <TextField
                    label="Final Liquidity (USDC)"
                    value={marketForm.final_liquidity_usdc}
                    onChange={(value) =>
                      setMarketForm((current) => ({
                        ...current,
                        final_liquidity_usdc: value,
                      }))
                    }
                    placeholder="optional"
                  />
                  <TextField
                    label="Opens At"
                    value={marketForm.opens_at}
                    onChange={(value) =>
                      setMarketForm((current) => ({
                        ...current,
                        opens_at: value,
                      }))
                    }
                    placeholder="YYYY-MM-DDTHH:mm"
                    type="datetime-local"
                  />
                  <TextField
                    label="Join Deadline"
                    value={marketForm.join_deadline_at}
                    onChange={(value) =>
                      setMarketForm((current) => ({
                        ...current,
                        join_deadline_at: value,
                      }))
                    }
                    placeholder="optional"
                    type="datetime-local"
                  />
                  <TextField
                    label="Decision Cutoff"
                    value={marketForm.decision_cutoff_at}
                    onChange={(value) =>
                      setMarketForm((current) => ({
                        ...current,
                        decision_cutoff_at: value,
                      }))
                    }
                    placeholder="YYYY-MM-DDTHH:mm"
                    type="datetime-local"
                  />
                  <TextField
                    label="Closes At"
                    value={marketForm.closes_at}
                    onChange={(value) =>
                      setMarketForm((current) => ({
                        ...current,
                        closes_at: value,
                      }))
                    }
                    placeholder="YYYY-MM-DDTHH:mm"
                    type="datetime-local"
                  />
                  <TextField
                    label="Resolves At"
                    value={marketForm.resolves_at}
                    onChange={(value) =>
                      setMarketForm((current) => ({
                        ...current,
                        resolves_at: value,
                      }))
                    }
                    placeholder="optional"
                    type="datetime-local"
                  />
                </section>

                <label className="grid gap-1 text-sm">
                  <span className="text-neutral-500">Description</span>
                  <textarea
                    value={marketForm.description}
                    onChange={(event) =>
                      setMarketForm((current) => ({
                        ...current,
                        description: event.target.value,
                      }))
                    }
                    className="min-h-32 rounded-md border border-input bg-input/20 p-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30"
                  />
                </label>

                <label className="grid gap-1 text-sm">
                  <span className="text-neutral-500">Topics</span>
                  <select
                    multiple
                    value={marketForm.topic_slugs}
                    onChange={(event) =>
                      setMarketForm((current) => ({
                        ...current,
                        topic_slugs: Array.from(event.target.selectedOptions).map(
                          (option) => option.value
                        ),
                      }))
                    }
                    className="min-h-32 rounded-md border border-input bg-input/20 px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30"
                  >
                    {availableTopics.map((topic) => (
                      <option key={topic.id} value={topic.slug}>
                        {topic.name}
                      </option>
                    ))}
                  </select>
                </label>

                <section className="grid gap-4 md:grid-cols-2">
                  <label className="grid gap-1 text-sm">
                    <span className="text-neutral-500">Rules</span>
                    <textarea
                      value={marketForm.rules_text}
                      onChange={(event) =>
                        setMarketForm((current) => ({
                          ...current,
                          rules_text: event.target.value,
                        }))
                      }
                      className="min-h-40 rounded-md border border-input bg-input/20 p-3 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30"
                    />
                  </label>
                  <label className="grid gap-1 text-sm">
                    <span className="text-neutral-500">Context JSON</span>
                    <textarea
                      value={marketForm.context_text}
                      onChange={(event) =>
                        setMarketForm((current) => ({
                          ...current,
                          context_text: event.target.value,
                        }))
                      }
                      className="min-h-40 rounded-md border border-input bg-input/20 p-3 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30"
                    />
                  </label>
                </section>

                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => void handleSaveMarket()} disabled={working}>
                    {marketForm.target ? "Save Market" : "Create Market"}
                  </Button>
                  {marketForm.target ? (
                    <Button asChild variant="outline">
                      <Link href={`/markets/${marketForm.target}`}>Open Public Page</Link>
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>

            <Card className="bg-white/80 dark:bg-white/5">
              <CardHeader>
                <CardTitle>Resolution Controls</CardTitle>
                <CardDescription>
                  Finalize the market outcome using the admin resolve endpoint.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <SelectField
                  label="Outcome"
                  value={resolveForm.outcome}
                  onChange={(value) =>
                    setResolveForm((current) => ({
                      ...current,
                      outcome: value as "YES" | "NO",
                    }))
                  }
                  options={[
                    { label: "YES", value: "YES" },
                    { label: "NO", value: "NO" },
                  ]}
                />
                <TextField
                  label="Resolved At"
                  value={resolveForm.resolved_at}
                  onChange={(value) =>
                    setResolveForm((current) => ({
                      ...current,
                      resolved_at: value,
                    }))
                  }
                  placeholder="optional"
                  type="datetime-local"
                />
                <TextField
                  label="Evidence URI"
                  value={resolveForm.evidence_uri}
                  onChange={(value) =>
                    setResolveForm((current) => ({
                      ...current,
                      evidence_uri: value,
                    }))
                  }
                  placeholder="optional"
                />
                <TextField
                  label="Submitted TX Signature"
                  value={resolveForm.submitted_tx_sig}
                  onChange={(value) =>
                    setResolveForm((current) => ({
                      ...current,
                      submitted_tx_sig: value,
                    }))
                  }
                  placeholder="optional"
                />
                <div className="md:col-span-2">
                  <Button onClick={() => void handleResolveMarket()} disabled={working}>
                    Resolve Market
                  </Button>
                </div>
              </CardContent>
            </Card>

            {selectedMarket ? (
              <Card className="bg-neutral-950 text-white ring-neutral-800 dark:bg-white dark:text-neutral-950">
                <CardHeader>
                  <CardTitle>Selected Market Snapshot</CardTitle>
                  <CardDescription className="text-neutral-400 dark:text-neutral-600">
                    Live detail from `/v1/markets/:marketIdOrSlug`.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 text-sm">
                  <MarketField
                    label="Status"
                    value={formatStatus(selectedMarket.data.market.status)}
                  />
                  <MarketField
                    label="Oracle Status"
                    value={formatStatus(
                      selectedMarket.data.market.resolution.oracle_status
                    )}
                  />
                  <MarketField
                    label="Proposed Outcome"
                    value={
                      selectedMarket.data.market.resolution.proposed_outcome ??
                      "Pending"
                    }
                  />
                  <MarketField
                    label="Final Outcome"
                    value={
                      selectedMarket.data.market.resolution.final_outcome ??
                      "Pending"
                    }
                  />
                  <MarketField
                    label="On-chain Pubkey"
                    mono
                    value={
                      selectedMarket.data.market.onchain.market_pubkey ??
                      "Not published yet"
                    }
                  />
                  <MarketField
                    label="Resolver"
                    mono
                    value={
                      selectedMarket.data.market.transparency.resolver_wallet ??
                      "Not assigned"
                    }
                  />
                </CardContent>
              </Card>
            ) : null}
          </div>
        </section>
      </div>
    </AdminGate>
  )
}

function TextField({
  label,
  onChange,
  placeholder,
  type = "text",
  value,
}: {
  label: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
  value: string
}) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-neutral-500">{label}</span>
      <Input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </label>
  )
}

function SelectField({
  label,
  onChange,
  options,
  value,
}: {
  label: string
  onChange: (value: string) => void
  options: Array<{ label: string; value: string }>
  value: string
}) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-neutral-500">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-md border border-input bg-input/20 px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function MarketField({
  label,
  mono = false,
  value,
}: {
  label: string
  mono?: boolean
  value: string
}) {
  return (
    <div>
      <p className="text-neutral-400 dark:text-neutral-600">{label}</p>
      <p className={`mt-1 font-medium ${mono ? "font-mono text-xs break-all" : ""}`}>
        {value}
      </p>
    </div>
  )
}

function buildMarketPayload(form: MarketFormState): MarketMutationInput {
  return {
    category: form.category.trim(),
    slug: form.slug.trim() || undefined,
    title: form.title.trim(),
    short_description: form.short_description.trim(),
    description: form.description.trim(),
    image_uri: normalizeNullableText(form.image_uri),
    status: form.status,
    oracle_source: form.oracle_source.trim(),
    settlement_asset: form.settlement_asset.trim(),
    onchain_market_pubkey: normalizeNullableText(form.onchain_market_pubkey),
    opens_at: normalizeIsoValue(form.opens_at) ?? new Date().toISOString(),
    join_deadline_at: normalizeIsoValue(form.join_deadline_at),
    decision_cutoff_at:
      normalizeIsoValue(form.decision_cutoff_at) ?? new Date().toISOString(),
    closes_at: normalizeIsoValue(form.closes_at) ?? new Date().toISOString(),
    resolves_at: normalizeIsoValue(form.resolves_at),
    total_liquidity_usdc: form.total_liquidity_usdc.trim() || "0",
    final_liquidity_usdc: normalizeNullableText(form.final_liquidity_usdc),
    resolver_wallet: normalizeNullableText(form.resolver_wallet),
    rules: form.rules_text
      .split("\n")
      .map((entry) => entry.trim())
      .filter(Boolean),
    context: parseContextText(form.context_text),
    topic_slugs: form.topic_slugs,
  }
}

function mapMarketDetailToForm(response: MarketDetailResponse): MarketFormState {
  const market = response.data.market

  return {
    target: market.slug,
    category: market.category.slug,
    slug: market.slug,
    title: market.title,
    short_description: market.short_description,
    description: market.description,
    image_uri: market.image_uri ?? "",
    status: market.status,
    oracle_source: market.resolution.oracle_source,
    settlement_asset: market.settlement.asset,
    onchain_market_pubkey: market.onchain.market_pubkey ?? "",
    opens_at: toDateTimeInput(market.timing.opens_at),
    join_deadline_at: toDateTimeInput(market.timing.join_deadline_at),
    decision_cutoff_at: toDateTimeInput(market.timing.decision_cutoff_at),
    closes_at: toDateTimeInput(market.timing.closes_at),
    resolves_at: toDateTimeInput(market.timing.resolves_at),
    total_liquidity_usdc: market.settlement.total_liquidity_usdc,
    final_liquidity_usdc: market.settlement.final_liquidity_usdc ?? "",
    resolver_wallet: market.transparency.resolver_wallet ?? "",
    rules_text: market.transparency.rules.map(String).join("\n"),
    context_text: JSON.stringify(market.transparency.context, null, 2),
    topic_slugs: market.topics.map((topic) => topic.slug),
  }
}

function normalizeNullableText(value: string) {
  const trimmedValue = value.trim()
  return trimmedValue ? trimmedValue : null
}

function parseContextText(value: string) {
  const trimmedValue = value.trim()

  if (!trimmedValue) {
    return {}
  }

  return JSON.parse(trimmedValue) as Record<string, unknown>
}

function normalizeIsoValue(value: string) {
  if (!value.trim()) {
    return undefined
  }

  return new Date(value).toISOString()
}

function toDateTimeInput(value?: string | null) {
  if (!value) {
    return ""
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ""
  }

  const offset = date.getTimezoneOffset()
  const shiftedDate = new Date(date.getTime() - offset * 60_000)
  return shiftedDate.toISOString().slice(0, 16)
}

function formatStatus(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}
