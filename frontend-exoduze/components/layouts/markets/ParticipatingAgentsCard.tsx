import Link from "next/link"

import { LocalizedDateTimeText } from "@/components/time/LocalizedTime"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { MarketAgent } from "@/hooks/Type"
import type { MarketCompetitionEntry } from "@/lib/market-competition"

import { DecisionRationale } from "./DecisionRationale"
import {
  formatAccuracyPct,
  formatConfidence,
  formatCurrency,
  formatCurrentStreak,
  formatProbability,
  formatTextLabel,
  getDecisionBadgeClass,
} from "./market-detail-helpers"

type ParticipatingAgentsCardProps = {
  agents: MarketAgent[]
  competitionEntryById: Map<string, MarketCompetitionEntry>
  marketSlug: string
  settlementAsset: string
}

export function ParticipatingAgentsCard({
  agents,
  competitionEntryById,
  marketSlug,
  settlementAsset,
}: ParticipatingAgentsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Participating Agents</CardTitle>
        <CardDescription>
          Locked agent versions, live probability, and market-specific support.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <ScrollArea className="h-[500px] pr-3">
          {agents.length ? (
            agents.map((marketAgent) => (
              <article
                key={marketAgent.market_agent_id}
                className="rounded-2xl border border-black/10 bg-white/70 p-4 dark:border-white/10 dark:bg-white/5"
              >
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="space-y-2">
                    <div>
                      <h3 className="text-lg font-semibold">
                        {marketAgent.agent.name}
                      </h3>
                      <p className="text-sm text-neutral-500">
                        {marketAgent.agent.description}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="secondary" className="rounded">
                        {marketAgent.locked_version.version_label}
                      </Badge>
                      <Badge variant="outline" className="rounded">
                        {marketAgent.locked_version.model_provider}
                      </Badge>
                      <Badge variant="outline" className="rounded">
                        {marketAgent.locked_version.model_name}
                      </Badge>
                      {marketAgent.agent.categories.map((category) => (
                        <Badge
                          key={`${marketAgent.market_agent_id}-${category.slug}`}
                          variant="outline"
                          className="rounded"
                        >
                          {category.name}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge
                      className={`rounded ${getDecisionBadgeClass(
                        marketAgent.current_decision?.side
                      )}`}
                    >
                      {marketAgent.current_decision?.side ?? "Pending"}
                    </Badge>
                    <Badge variant="outline" className="rounded">
                      {formatTextLabel(
                        marketAgent.commitment.verification_status
                      )}
                    </Badge>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 text-sm md:grid-cols-2 xl:grid-cols-5">
                  <div>
                    <p className="text-neutral-500">Implied YES Prob</p>
                    <p className="mt-1 font-medium">
                      {formatProbability(
                        competitionEntryById.get(marketAgent.market_agent_id)
                          ?.currentYesProbability ?? null
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-neutral-500">Confidence</p>
                    <p className="mt-1 font-medium">
                      {formatConfidence(
                        marketAgent.current_decision?.confidence
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-neutral-500">Accuracy</p>
                    <p className="mt-1 font-medium">
                      {formatAccuracyPct(marketAgent.stats?.accuracy_pct)}
                    </p>
                  </div>
                  <div>
                    <p className="text-neutral-500">Current Streak</p>
                    <p className="mt-1 font-medium">
                      {formatCurrentStreak(marketAgent.stats?.current_streak)}
                    </p>
                  </div>
                  <div>
                    <p className="text-neutral-500">Market Followers</p>
                    <p className="mt-1 font-medium">
                      {marketAgent.market_stats.follower_count}
                    </p>
                  </div>
                  <div>
                    <p className="text-neutral-500">Market Follower Stake</p>
                    <p className="mt-1 font-medium">
                      {formatCurrency(
                        marketAgent.market_stats.follower_staked_usdc,
                        settlementAsset
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-neutral-500">Support Share</p>
                    <p className="mt-1 font-medium">
                      {formatProbability(
                        marketAgent.market_stats.support_share_pct
                      )}
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
                  <div>
                    <p className="text-neutral-500">Joined At</p>
                    <p className="mt-1 font-medium">
                      <LocalizedDateTimeText
                        value={marketAgent.locked_version.joined_at}
                      />
                    </p>
                  </div>
                  <div>
                    <p className="text-neutral-500">Snapshot</p>
                    {marketAgent.commitment.snapshot_uri ? (
                      <Link
                        href={`/markets/${encodeURIComponent(
                          marketSlug
                        )}/snapshots/${encodeURIComponent(
                          marketAgent.market_agent_id
                        )}`}
                        target="_blank"
                        className="mt-1 inline-flex font-medium text-neutral-900 underline dark:text-neutral-100"
                      >
                        View snapshot
                      </Link>
                    ) : (
                      <p className="mt-1 font-medium">Pending</p>
                    )}
                  </div>
                  <div>
                    <p className="text-neutral-500">Resolved Markets</p>
                    <p className="mt-1 font-medium">
                      {marketAgent.stats?.resolved_markets ?? "N/A"}
                    </p>
                  </div>
                </div>

                {marketAgent.current_decision?.reason_summary ? (
                  <div className="mt-4">
                    <p className="text-sm text-neutral-500">
                      Current Rationale
                    </p>
                    <p className="mt-1 text-sm leading-6 text-neutral-700 dark:text-neutral-300">
                      {marketAgent.current_decision.reason_summary}
                    </p>
                    <DecisionRationale
                      keySignals={marketAgent.current_decision.key_signals}
                      riskFactors={marketAgent.current_decision.risk_factors}
                    />
                  </div>
                ) : null}
              </article>
            ))
          ) : (
            <p className="text-sm text-neutral-500">
              No agents have joined this market yet.
            </p>
          )}
        </ScrollArea>
      </CardContent>
    </Card >
  )
}
