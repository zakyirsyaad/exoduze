"use client"

import Link from "next/link"

import type { Agent } from "@/hooks/Type"
import {
  formatRiskProfileLabel,
  formatSpecializationLabel,
  getAgentInitials,
} from "@/lib/battle-config"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

type AgentCardProps = {
  actionHref?: string
  actionLabel?: string
  agent: Pick<
    Agent,
    | "avatar_uri"
    | "description"
    | "name"
    | "risk_profile"
    | "slug"
    | "specialization"
  > & {
    stats?: {
      accuracy_pct?: string | null
      wins?: number | null
    } | null
  }
  compact?: boolean
  disabled?: boolean
  onUse?: () => void
  selected?: boolean
}

export function AgentCard({
  actionHref,
  actionLabel = "View Agent",
  agent,
  compact = false,
  disabled = false,
  onUse,
  selected = false,
}: AgentCardProps) {
  const accuracyLabel =
    agent.stats?.accuracy_pct != null
      ? `${Number(agent.stats.accuracy_pct).toFixed(1)}%`
      : "TBD"
  const winsLabel =
    typeof agent.stats?.wins === "number" ? String(agent.stats.wins) : "TBD"

  return (
    <Card
      className={cn(
        "h-full border border-black/5 bg-white/80 transition dark:border-white/10 dark:bg-white/5",
        selected
          ? "ring-2 ring-emerald-500/50"
          : "hover:-translate-y-0.5 hover:shadow-lg",
        disabled && "opacity-60"
      )}
    >
      <CardHeader className={compact ? "pb-2" : undefined}>
        <div className="flex items-start gap-3">
          <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-neutral-900 text-sm font-semibold text-white dark:bg-neutral-100 dark:text-neutral-900">
            {agent.avatar_uri ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt={agent.name}
                className="size-full object-cover"
                src={agent.avatar_uri}
              />
            ) : (
              getAgentInitials(agent.name)
            )}
          </div>
          <div className="min-w-0 space-y-2">
            <div>
              <CardTitle className="truncate text-base">{agent.name}</CardTitle>
              <p className="text-xs text-neutral-500">@{agent.slug}</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="secondary" className="rounded">
                {formatSpecializationLabel(agent.specialization)}
              </Badge>
              <Badge variant="outline" className="rounded">
                {formatRiskProfileLabel(agent.risk_profile)}
              </Badge>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className={cn("space-y-4", compact && "space-y-3")}>
        <p className="line-clamp-3 min-h-14 text-sm text-neutral-600 dark:text-neutral-400">
          {agent.description || "No description yet."}
        </p>

        <div className="grid grid-cols-2 gap-2 rounded-2xl bg-neutral-950/[0.03] p-3 text-sm dark:bg-white/5">
          <Metric label="Accuracy" value={accuracyLabel} />
          <Metric label="Wins" value={winsLabel} />
        </div>
      </CardContent>
      <CardFooter className="flex gap-2">
        {onUse ? (
          <Button
            type="button"
            className="flex-1"
            disabled={disabled}
            onClick={onUse}
          >
            {actionLabel}
          </Button>
        ) : actionHref ? (
          <Button asChild className="flex-1" disabled={disabled}>
            <Link href={actionHref}>{actionLabel}</Link>
          </Button>
        ) : null}

        <Button asChild variant="outline" className="flex-1">
          <Link href={`/agents/${agent.slug}`}>View Agent</Link>
        </Button>
      </CardFooter>
    </Card>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] tracking-[0.16em] text-neutral-500 uppercase">
        {label}
      </p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  )
}
