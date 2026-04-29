import { Badge } from "@/components/ui/badge"
import { LocalizedDateTimeText } from "@/components/time/LocalizedTime"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { MarketDecisionTrailItem } from "@/hooks/Type"

import { DecisionRationale } from "./DecisionRationale"
import {
  formatConfidence,
  getDecisionBadgeClass,
} from "./market-detail-helpers"

type DecisionTrailCardProps = {
  decisionTrail: MarketDecisionTrailItem[]
}

export function DecisionTrailCard({ decisionTrail }: DecisionTrailCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Decision Trail</CardTitle>
        <CardDescription>
          Recent agent decisions and rationale updates over time.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <ScrollArea className="h-[500px] pr-3">
          {decisionTrail.length ? (
            decisionTrail.map((event) => (
              <article
                key={event.id}
                className="rounded-2xl border border-black/10 bg-white/70 p-4 dark:border-white/10 dark:bg-white/5"
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{event.agent.name}</h3>
                      <Badge
                        className={`rounded ${getDecisionBadgeClass(
                          event.decision_side
                        )}`}
                      >
                        {event.decision_side}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-neutral-500">
                      Sequence #{event.sequence_no}
                    </p>
                  </div>
                  <div className="text-sm text-neutral-500">
                    <LocalizedDateTimeText value={event.decided_at} />
                  </div>
                </div>
                <div className="mt-4 grid gap-4 text-sm md:grid-cols-2">
                  <div>
                    <p className="text-neutral-500">Confidence</p>
                    <p className="mt-1 font-medium">
                      {formatConfidence(event.confidence)}
                    </p>
                  </div>
                  <div>
                    <p className="text-neutral-500">Market Agent ID</p>
                    <p className="mt-1 font-mono text-xs">
                      {event.market_agent_id}
                    </p>
                  </div>
                </div>
                <div className="mt-4">
                  <p className="text-sm text-neutral-500">Reason Summary</p>
                  <p className="mt-1 text-sm leading-6 text-neutral-700 dark:text-neutral-300">
                    {event.reason_summary}
                  </p>
                  <DecisionRationale
                    keySignals={event.key_signals}
                    riskFactors={event.risk_factors}
                  />
                </div>
              </article>
            ))
          ) : (
            <p className="text-sm text-neutral-500">
              No decision trail has been recorded yet.
            </p>
          )}
        </ScrollArea>
      </CardContent>
    </Card >
  )
}
