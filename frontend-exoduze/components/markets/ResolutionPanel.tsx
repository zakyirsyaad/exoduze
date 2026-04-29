"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { useUserTimeZone } from "@/components/time/UserTimeZoneProvider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { useAuth } from "@/hooks/useAuth"
import type { MarketDetail } from "@/hooks/Type"
import { apiFetch } from "@/lib/api"
import { formatDateTimeForTimeZone } from "@/lib/time-formatters"

type ResolutionPanelProps = {
  market: MarketDetail
}

export function ResolutionPanel({ market }: ResolutionPanelProps) {
  const auth = useAuth()
  const router = useRouter()
  const timeZone = useUserTimeZone()
  const [reason, setReason] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)
  const [nowMs, setNowMs] = React.useState<number | null>(null)
  const resolution = market.resolution
  const canDispute =
    nowMs !== null &&
    resolution.resolution_id &&
    resolution.proposal_status === "proposed" &&
    resolution.dispute_deadline &&
    Date.parse(resolution.dispute_deadline) > nowMs

  React.useEffect(() => {
    const timeoutId = window.setTimeout(() => setNowMs(Date.now()), 0)
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 30_000)

    return () => {
      window.clearTimeout(timeoutId)
      window.clearInterval(intervalId)
    }
  }, [])

  async function disputeResolution() {
    if (!resolution.resolution_id || !canDispute) {
      return
    }

    setSubmitting(true)
    try {
      await apiFetch(
        `/v1/markets/${encodeURIComponent(
          market.slug
        )}/resolutions/${encodeURIComponent(resolution.resolution_id)}/dispute`,
        {
          method: "POST",
          body: JSON.stringify({ reason }),
        }
      )
      toast.success("Resolution disputed")
      setReason("")
      router.refresh()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to dispute resolution"
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Resolution</CardTitle>
        <CardDescription>
          Oracle proposal, snapshot evidence, and dispute status.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        <div className="grid gap-4 md:grid-cols-2">
          <ResolutionField
            label="Oracle Source"
            value={formatLabel(resolution.oracle_source)}
          />
          <ResolutionField
            label="Oracle Status"
            value={formatLabel(resolution.oracle_status)}
          />
          <ResolutionField
            label="Proposed Outcome"
            value={resolution.proposed_outcome ?? "Pending"}
          />
          <ResolutionField
            label="Final Outcome"
            value={resolution.final_outcome ?? "Pending"}
          />
          <ResolutionField
            label="Snapshot Generated"
            value={formatDateTimeForTimeZone(
              resolution.evidence_snapshot?.generated_at,
              { timeZone }
            )}
          />
          <ResolutionField
            label="Dispute Deadline"
            value={formatDateTimeForTimeZone(resolution.dispute_deadline, {
              timeZone,
            })}
          />
        </div>

        {resolution.evidence_summary ? (
          <div className="rounded-md border border-black/10 p-3 dark:border-white/10">
            <p className="text-neutral-500">Evidence Summary</p>
            <p className="mt-1 leading-6">{resolution.evidence_summary}</p>
          </div>
        ) : (
          <p className="rounded-md border border-dashed p-3 text-neutral-500">
            Snapshot evidence is not available yet.
          </p>
        )}

        {resolution.dispute ? (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">Dispute</p>
              <Badge variant="outline" className="rounded">
                {formatLabel(resolution.dispute.status)}
              </Badge>
            </div>
            <p className="mt-2 text-neutral-600 dark:text-neutral-300">
              {resolution.dispute.reason ?? "No reason provided"}
            </p>
          </div>
        ) : null}

        {canDispute ? (
          <div className="grid gap-3">
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="min-h-24 rounded-md border border-input bg-input/20 p-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30"
              placeholder="Explain what is wrong with the snapshot evidence or rank lookup."
            />
            <Button
              onClick={disputeResolution}
              disabled={
                !auth.isAuthenticated || submitting || reason.trim().length < 10
              }
            >
              {submitting ? "Submitting..." : "Dispute Resolution"}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function ResolutionField({
  label,
  value,
}: {
  label: string
  value: React.ReactNode
}) {
  return (
    <div>
      <p className="text-neutral-500">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  )
}

function formatLabel(value?: string | null) {
  return (value ?? "pending")
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}
