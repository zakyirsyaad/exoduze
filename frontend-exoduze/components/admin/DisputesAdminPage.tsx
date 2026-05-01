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
import {
  acceptDispute,
  fetchAdminDisputes,
  rejectDispute,
} from "@/lib/admin-client"
import { formatDisplayDateTime } from "@/lib/time-formatters"

type DisputeStatusFilter = "open" | "accepted" | "rejected"

export function DisputesAdminPage() {
  const [status, setStatus] = React.useState<DisputeStatusFilter>("open")
  const [loading, setLoading] = React.useState(true)
  const [working, setWorking] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [disputes, setDisputes] =
    React.useState<Awaited<ReturnType<typeof fetchAdminDisputes>> | null>(null)

  const loadDisputes = React.useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetchAdminDisputes(status)
      setDisputes(response)
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load disputes"
      )
    } finally {
      setLoading(false)
    }
  }, [status])

  React.useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadDisputes()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [loadDisputes])

  async function handleAccept(disputeId: string, outcome: "YES" | "NO") {
    setWorking(true)

    try {
      await acceptDispute(disputeId, outcome)
      toast.success(`Dispute accepted with ${outcome} as final outcome`)
      await loadDisputes()
    } catch (actionError) {
      toast.error(
        actionError instanceof Error
          ? actionError.message
          : "Unable to accept dispute"
      )
    } finally {
      setWorking(false)
    }
  }

  async function handleReject(disputeId: string) {
    setWorking(true)

    try {
      await rejectDispute(disputeId)
      toast.success("Oracle proposal kept")
      await loadDisputes()
    } catch (actionError) {
      toast.error(
        actionError instanceof Error
          ? actionError.message
          : "Unable to reject dispute"
      )
    } finally {
      setWorking(false)
    }
  }

  return (
    <AdminGate>
      <div className="space-y-6">
        <Card className="bg-white/80 dark:bg-white/5">
          <CardHeader>
            <CardTitle>Dispute Desk</CardTitle>
            <CardDescription>
              Review resolution disputes and finalize the outcome flow exposed by
              `/v1/admin/market-disputes`.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {(["open", "accepted", "rejected"] as DisputeStatusFilter[]).map(
              (item) => (
                <Button
                  key={item}
                  variant={status === item ? "default" : "outline"}
                  onClick={() => setStatus(item)}
                >
                  {formatStatus(item)}
                </Button>
              )
            )}
            <Button
              variant="outline"
              onClick={() => void loadDisputes()}
              disabled={loading}
            >
              {loading ? "Refreshing..." : "Refresh"}
            </Button>
          </CardContent>
        </Card>

        {loading ? (
          <Card>
            <CardContent className="p-6 text-sm text-neutral-500">
              Loading disputes...
            </CardContent>
          </Card>
        ) : null}

        {error ? (
          <Card>
            <CardHeader>
              <CardTitle>Unable To Load Disputes</CardTitle>
              <CardDescription>{error}</CardDescription>
            </CardHeader>
          </Card>
        ) : null}

        {!loading && !error && !disputes?.data.length ? (
          <Card>
            <CardHeader>
              <CardTitle>No {formatStatus(status)} disputes</CardTitle>
              <CardDescription>
                There are no disputes in this state right now. Open disputes
                will appear here after users challenge a proposed resolution.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : null}

        <section className="grid gap-4">
          {disputes?.data.map((dispute) => (
            <Card key={dispute.id} className="bg-white/80 dark:bg-white/5">
              <CardHeader>
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-lg">{dispute.market.title}</CardTitle>
                    <CardDescription>
                      Oracle proposed {dispute.resolution.proposed_outcome}
                    </CardDescription>
                  </div>
                  <Badge variant="outline" className="w-fit rounded">
                    {formatStatus(dispute.status)}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4 text-sm">
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <DisputeField label="Market slug" value={dispute.market.slug} />
                  <DisputeField
                    label="Disputed by"
                    value={dispute.disputed_by}
                    mono
                  />
                  <DisputeField
                    label="Created"
                    value={formatDisplayDateTime(dispute.created_at)}
                  />
                  <DisputeField
                    label="Dispute deadline"
                    value={formatDisplayDateTime(
                      dispute.resolution.dispute_deadline
                    )}
                  />
                </div>

                <div className="rounded-2xl border border-black/10 p-4 dark:border-white/10">
                  <p className="text-neutral-500">Dispute Reason</p>
                  <p className="mt-2 leading-6">{dispute.reason}</p>
                </div>

                <div className="rounded-2xl border border-black/10 p-4 dark:border-white/10">
                  <p className="text-neutral-500">Evidence Summary</p>
                  <p className="mt-2 leading-6">
                    {dispute.resolution.evidence_summary}
                  </p>
                  <p className="mt-2 text-xs text-neutral-500">
                    Snapshot generated{" "}
                    {formatDisplayDateTime(
                      dispute.resolution.evidence_snapshot_generated_at
                    )}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline">
                    <Link href={`/markets/${dispute.market.slug}`}>
                      Open Market
                    </Link>
                  </Button>
                  {status === "open" ? (
                    <>
                      <Button
                        onClick={() => void handleAccept(dispute.id, "YES")}
                        disabled={working}
                      >
                        {working ? "Finalizing..." : "Finalize YES"}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => void handleAccept(dispute.id, "NO")}
                        disabled={working}
                      >
                        {working ? "Finalizing..." : "Finalize NO"}
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={() => void handleReject(dispute.id)}
                        disabled={working}
                      >
                        {working ? "Updating..." : "Keep Oracle Result"}
                      </Button>
                    </>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </section>
      </div>
    </AdminGate>
  )
}

function DisputeField({
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
      <p className={`mt-1 font-medium ${mono ? "font-mono text-xs break-all" : ""}`}>
        {value}
      </p>
    </div>
  )
}

function formatStatus(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
