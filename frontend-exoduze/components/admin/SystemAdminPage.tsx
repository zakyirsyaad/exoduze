"use client"

import * as React from "react"
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
import {
  fetchHealth,
  fetchOnchainConfig,
  refreshFeed,
  runCronJob,
  updateTreasuryAuthority,
} from "@/lib/admin-client"
import type { CronJobId, OnchainConfigSummary } from "@/lib/admin-types"
import { formatDisplayDateTime } from "@/lib/time-formatters"

const cronStorageKey = "exoduze:cron-secret"

export function SystemAdminPage() {
  const [health, setHealth] = React.useState<Awaited<ReturnType<typeof fetchHealth>> | null>(null)
  const [healthLoading, setHealthLoading] = React.useState(true)
  const [healthError, setHealthError] = React.useState<string | null>(null)
  const [onchainConfig, setOnchainConfig] = React.useState<OnchainConfigSummary | null>(null)
  const [onchainConfigLoading, setOnchainConfigLoading] = React.useState(true)
  const [onchainConfigError, setOnchainConfigError] = React.useState<string | null>(null)
  const [treasuryAuthority, setTreasuryAuthority] = React.useState("")
  const [feedCategory, setFeedCategory] = React.useState("")
  const [latestResult, setLatestResult] = React.useState<unknown>(null)
  const [working, setWorking] = React.useState(false)
  const [cronSecret, setCronSecret] = React.useState("")
  const [snapshotForm, setSnapshotForm] = React.useState({
    category: "finance",
    dev: false,
    limit: "10",
  })
  const [marketForm, setMarketForm] = React.useState({
    category: "finance",
    required_rank: "3",
    max_markets: "3",
    dev_sample: false,
  })

  const loadHealth = React.useCallback(async () => {
    setHealthLoading(true)
    setHealthError(null)

    try {
      const response = await fetchHealth()
      setHealth(response)
    } catch (loadError) {
      setHealthError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load health status"
      )
    } finally {
      setHealthLoading(false)
    }
  }, [])

  const loadOnchainConfig = React.useCallback(async () => {
    setOnchainConfigLoading(true)
    setOnchainConfigError(null)

    try {
      const response = await fetchOnchainConfig()
      const config = response.data.config

      setOnchainConfig(config)
      setTreasuryAuthority((currentValue) =>
        currentValue.trim() ? currentValue : config?.treasury_authority ?? ""
      )
    } catch (loadError) {
      setOnchainConfigError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load on-chain config"
      )
    } finally {
      setOnchainConfigLoading(false)
    }
  }, [])

  React.useEffect(() => {
    const healthTimeoutId = window.setTimeout(() => {
      void loadHealth()
    }, 0)
    const onchainTimeoutId = window.setTimeout(() => {
      void loadOnchainConfig()
    }, 0)
    const sessionSecret = window.sessionStorage.getItem(cronStorageKey) ?? ""
    const secretTimeoutId = window.setTimeout(() => {
      setCronSecret(sessionSecret)
    }, 0)

    return () => {
      window.clearTimeout(healthTimeoutId)
      window.clearTimeout(onchainTimeoutId)
      window.clearTimeout(secretTimeoutId)
    }
  }, [loadHealth, loadOnchainConfig])

  React.useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    if (cronSecret.trim()) {
      window.sessionStorage.setItem(cronStorageKey, cronSecret.trim())
      return
    }

    window.sessionStorage.removeItem(cronStorageKey)
  }, [cronSecret])

  async function handleRefreshFeed() {
    setWorking(true)

    try {
      const result = await refreshFeed(feedCategory.trim() || undefined)
      setLatestResult(result)
      toast.success("Feed refresh triggered")
    } catch (actionError) {
      toast.error(
        actionError instanceof Error ? actionError.message : "Unable to refresh feed"
      )
    } finally {
      setWorking(false)
    }
  }

  async function handleRunCron(jobId: CronJobId) {
    if (!cronSecret.trim()) {
      toast.error("Cron secret is required to run cron endpoints")
      return
    }

    setWorking(true)

    try {
      const result = await runCronJob(
        jobId,
        buildCronPayload(jobId, snapshotForm, marketForm),
        cronSecret.trim()
      )
      setLatestResult(result)
      toast.success(`Cron job ${jobId} finished`)
    } catch (actionError) {
      toast.error(
        actionError instanceof Error ? actionError.message : "Unable to run cron job"
      )
    } finally {
      setWorking(false)
    }
  }

  async function handleUpdateTreasuryAuthority() {
    const nextTreasuryAuthority = treasuryAuthority.trim()

    if (!nextTreasuryAuthority) {
      toast.error("Treasury authority is required")
      return
    }

    setWorking(true)

    try {
      const result = await updateTreasuryAuthority({
        treasury_authority: nextTreasuryAuthority,
      })

      setLatestResult(result)
      setOnchainConfig(result.data)
      setTreasuryAuthority(result.data.treasury_authority)
      toast.success(
        result.data.already_set
          ? "Treasury authority is already set"
          : "Treasury authority updated"
      )
    } catch (actionError) {
      toast.error(
        actionError instanceof Error
          ? actionError.message
          : "Unable to update treasury authority"
      )
    } finally {
      setWorking(false)
    }
  }

  return (
    <AdminGate>
      <div className="space-y-6">
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <Card className="bg-white/80 dark:bg-white/5">
            <CardHeader>
              <CardTitle>System Health</CardTitle>
              <CardDescription>
                Production health check using `/health`.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              {healthLoading ? (
                <p className="text-sm text-neutral-500">Checking backend health...</p>
              ) : healthError ? (
                <p className="text-sm text-red-500">{healthError}</p>
              ) : health ? (
                <div className="grid gap-3 text-sm md:grid-cols-3">
                  <HealthField label="Status" value={health.ok ? "OK" : "Degraded"} />
                  <HealthField label="Service" value={health.service} />
                  <HealthField
                    label="Timestamp"
                    value={formatDisplayDateTime(health.timestamp)}
                  />
                </div>
              ) : null}
              <Button variant="outline" onClick={() => void loadHealth()}>
                Refresh Health
              </Button>
            </CardContent>
          </Card>

          <Card className="bg-white/80 dark:bg-white/5">
            <CardHeader>
              <CardTitle>Feed Refresh</CardTitle>
              <CardDescription>
                Trigger `/v1/feed/refresh` for all categories or one category
                slug.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <label className="grid gap-1 text-sm">
                <span className="text-neutral-500">Category slug</span>
                <Input
                  value={feedCategory}
                  onChange={(event) => setFeedCategory(event.target.value)}
                  placeholder="Leave empty to refresh all"
                />
              </label>
              <Button onClick={() => void handleRefreshFeed()} disabled={working}>
                Refresh Feed
              </Button>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <Card className="bg-white/80 dark:bg-white/5">
            <CardHeader>
              <CardTitle>On-chain Config</CardTitle>
              <CardDescription>
                Live config state loaded from the Solana program.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              {onchainConfigLoading ? (
                <p className="text-sm text-neutral-500">Loading on-chain config...</p>
              ) : onchainConfigError ? (
                <p className="text-sm text-red-500">{onchainConfigError}</p>
              ) : onchainConfig ? (
                <div className="grid gap-3 text-sm md:grid-cols-2">
                  <ConfigField label="Config PDA" value={onchainConfig.config_pubkey} mono />
                  <ConfigField
                    label="Treasury Authority"
                    value={onchainConfig.treasury_authority}
                    mono
                  />
                  <ConfigField
                    label="Admin Authority"
                    value={onchainConfig.admin_authority}
                    mono
                  />
                  <ConfigField
                    label="Oracle Authority"
                    value={onchainConfig.oracle_authority}
                    mono
                  />
                  <ConfigField
                    label="Status"
                    value={onchainConfig.paused ? "Paused" : "Active"}
                  />
                  <ConfigField
                    label="Fee"
                    value={`${onchainConfig.fee_bps} bps`}
                  />
                </div>
              ) : (
                <p className="text-sm text-neutral-500">
                  On-chain config has not been initialized yet.
                </p>
              )}
              <Button variant="outline" onClick={() => void loadOnchainConfig()}>
                Refresh On-chain Config
              </Button>
            </CardContent>
          </Card>

          <Card className="bg-white/80 dark:bg-white/5">
            <CardHeader>
              <CardTitle>Treasury Rotation</CardTitle>
              <CardDescription>
                Update `treasury_authority` for future payout fee transfers.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <label className="grid gap-1 text-sm">
                <span className="text-neutral-500">Treasury wallet</span>
                <Input
                  value={treasuryAuthority}
                  onChange={(event) => setTreasuryAuthority(event.target.value)}
                  placeholder="Paste a Solana public key"
                />
              </label>
              <Button
                onClick={() => void handleUpdateTreasuryAuthority()}
                disabled={working}
              >
                Update Treasury Authority
              </Button>
            </CardContent>
          </Card>
        </section>

        <Card className="bg-white/80 dark:bg-white/5">
          <CardHeader>
            <CardTitle>Cron Secret</CardTitle>
            <CardDescription>
              Cron endpoints require `Authorization: Bearer CRON_SECRET`. This
              value is stored only in session storage for the current browser tab.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <Input
              type="password"
              value={cronSecret}
              onChange={(event) => setCronSecret(event.target.value)}
              placeholder="Paste CRON_SECRET"
            />
            <Button variant="outline" onClick={() => setCronSecret("")}>
              Clear Secret
            </Button>
          </CardContent>
        </Card>

        <section className="grid gap-4 lg:grid-cols-2">
          <CronCard
            description="Generate topic snapshots with optional dev mode."
            title="Generate Topic Snapshot"
            onRun={() => void handleRunCron("generate-topic-snapshot")}
            running={working}
          >
            <label className="grid gap-1 text-sm">
              <span className="text-neutral-500">Category</span>
              <Input
                value={snapshotForm.category}
                onChange={(event) =>
                  setSnapshotForm((current) => ({
                    ...current,
                    category: event.target.value,
                  }))
                }
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-neutral-500">Limit</span>
              <Input
                type="number"
                value={snapshotForm.limit}
                onChange={(event) =>
                  setSnapshotForm((current) => ({
                    ...current,
                    limit: event.target.value,
                  }))
                }
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={snapshotForm.dev}
                onChange={(event) =>
                  setSnapshotForm((current) => ({
                    ...current,
                    dev: event.target.checked,
                  }))
                }
              />
              <span>Use dev snapshot</span>
            </label>
          </CronCard>

          <CronCard
            description="Create 24-hour draft markets from hot-topic snapshots."
            title="Generate Markets"
            onRun={() => void handleRunCron("generate-markets")}
            running={working}
          >
            <label className="grid gap-1 text-sm">
              <span className="text-neutral-500">Category</span>
              <Input
                value={marketForm.category}
                onChange={(event) =>
                  setMarketForm((current) => ({
                    ...current,
                    category: event.target.value,
                  }))
                }
              />
            </label>
            <p className="rounded-2xl border border-dashed border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-600 dark:border-white/10 dark:bg-white/5 dark:text-neutral-300">
              Generated markets open immediately and automatically resolve 24
              hours later.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span className="text-neutral-500">Required rank</span>
                <Input
                  type="number"
                  value={marketForm.required_rank}
                  onChange={(event) =>
                    setMarketForm((current) => ({
                      ...current,
                      required_rank: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-neutral-500">Max markets</span>
                <Input
                  type="number"
                  value={marketForm.max_markets}
                  onChange={(event) =>
                    setMarketForm((current) => ({
                      ...current,
                      max_markets: event.target.value,
                    }))
                  }
                />
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={marketForm.dev_sample}
                onChange={(event) =>
                  setMarketForm((current) => ({
                    ...current,
                    dev_sample: event.target.checked,
                  }))
                }
              />
              <span>Use dev sample market</span>
            </label>
          </CronCard>

          <CronCard
            description="Run automatic oracle proposal generation for eligible markets."
            title="Resolve Markets"
            onRun={() => void handleRunCron("resolve-markets")}
            running={working}
          >
            <Badge variant="outline" className="w-fit rounded">
              No request body needed
            </Badge>
          </CronCard>

          <CronCard
            description="Finalize elapsed proposed resolutions."
            title="Finalize Resolutions"
            onRun={() => void handleRunCron("finalize-resolutions")}
            running={working}
          >
            <Badge variant="outline" className="w-fit rounded">
              No request body needed
            </Badge>
          </CronCard>
        </section>

        <Card className="min-h-96 bg-neutral-950 text-white ring-neutral-800 dark:bg-white dark:text-neutral-950">
          <CardHeader>
            <CardTitle>Latest Result</CardTitle>
            <CardDescription className="text-neutral-400 dark:text-neutral-600">
              Feed and cron job responses appear here.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {latestResult ? (
              <pre className="max-h-[520px] overflow-auto rounded-2xl bg-white/10 p-4 text-xs text-white dark:bg-black/5 dark:text-neutral-950">
                {JSON.stringify(latestResult, null, 2)}
              </pre>
            ) : (
              <p className="text-sm text-neutral-400 dark:text-neutral-600">
                No action has been run yet.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminGate>
  )
}

function CronCard({
  children,
  description,
  onRun,
  running,
  title,
}: {
  children: React.ReactNode
  description: string
  onRun: () => void
  running: boolean
  title: string
}) {
  return (
    <Card className="bg-white/80 dark:bg-white/5">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {children}
        <Button onClick={onRun} disabled={running}>
          Run Job
        </Button>
      </CardContent>
    </Card>
  )
}

function HealthField({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div>
      <p className="text-neutral-500">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  )
}

function ConfigField({
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
      <p className="text-neutral-500">{label}</p>
      <p className={mono ? "mt-1 break-all font-mono text-xs" : "mt-1 font-medium"}>
        {value}
      </p>
    </div>
  )
}

function buildCronPayload(
  jobId: CronJobId,
  snapshotForm: {
    category: string
    dev: boolean
    limit: string
  },
  marketForm: {
    category: string
    required_rank: string
    max_markets: string
    dev_sample: boolean
  }
) {
  if (jobId === "generate-topic-snapshot") {
    return {
      category: snapshotForm.category.trim() || "finance",
      dev: snapshotForm.dev,
      limit: clampPositiveInteger(snapshotForm.limit, 10),
    }
  }

  if (jobId === "generate-markets") {
    return {
      category: marketForm.category.trim() || "finance",
      required_rank: clampPositiveInteger(marketForm.required_rank, 3),
      max_markets: clampPositiveInteger(marketForm.max_markets, 3),
      dev_sample: marketForm.dev_sample,
    }
  }

  return {}
}

function clampPositiveInteger(value: string, fallback: number) {
  const parsedValue = Number(value)

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return fallback
  }

  return Math.round(parsedValue)
}
