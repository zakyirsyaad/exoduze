import type { MarketDetailTiming, MarketStatus } from "@/hooks/Type"
import { formatDateTime, formatStatusLabel } from "@/components/layouts/markets/market-detail-helpers"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

type BattleTimelineProps = {
  status: MarketStatus
  timing: MarketDetailTiming
}

export function BattleTimeline({ status, timing }: BattleTimelineProps) {
  const items = [
    { label: "Battle opens", value: timing.opens_at },
    { label: "Agent join deadline", value: timing.join_deadline_at },
    { label: "Decision cutoff", value: timing.decision_cutoff_at },
    { label: "Battle closes", value: timing.closes_at },
    { label: "Settlement target", value: timing.resolves_at },
  ].filter((item) => item.value)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Battle Timeline</CardTitle>
        <CardDescription>
          Current status: {formatStatusLabel(status)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {items.map((item) => (
          <div
            key={`${item.label}-${item.value}`}
            className="rounded-xl border border-black/10 px-3 py-3 dark:border-white/10"
          >
            <p className="text-neutral-500">{item.label}</p>
            <p className="mt-1 font-medium">
              {item.value ? formatDateTime(item.value) : "TBD"}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
