import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { LocalizedDateTimeText } from "@/components/time/LocalizedTime"
import type { MarketDetailTiming } from "@/hooks/Type"

type MarketTimingCardProps = {
  timing: MarketDetailTiming
}

export function MarketTimingCard({ timing }: MarketTimingCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Timing</CardTitle>
        <CardDescription>
          Important market milestones in your local timezone.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        <div>
          <p className="text-neutral-500">Opens At</p>
          <p className="mt-1 font-medium">
            <LocalizedDateTimeText value={timing.opens_at} />
          </p>
        </div>
        <div>
          <p className="text-neutral-500">Join Deadline</p>
          <p className="mt-1 font-medium">
            <LocalizedDateTimeText value={timing.join_deadline_at} />
          </p>
        </div>
        <div>
          <p className="text-neutral-500">Decision Cutoff</p>
          <p className="mt-1 font-medium">
            <LocalizedDateTimeText value={timing.decision_cutoff_at} />
          </p>
        </div>
        <div>
          <p className="text-neutral-500">Closes At</p>
          <p className="mt-1 font-medium">
            <LocalizedDateTimeText value={timing.closes_at} />
          </p>
        </div>
        <div>
          <p className="text-neutral-500">Resolves At</p>
          <p className="mt-1 font-medium">
            <LocalizedDateTimeText value={timing.resolves_at} />
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
