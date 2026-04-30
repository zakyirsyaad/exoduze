import Link from "next/link"
import { notFound } from "next/navigation"

import { BattleCard } from "@/components/BattleCard"
import { MarketActivityCard } from "@/components/layouts/markets/MarketActivityCard"
import CountdownProgress from "@/components/layouts/markets/CountdownProgress"
import { Curve } from "@/components/layouts/markets/Curve"
import { DecisionTrailCard } from "@/components/layouts/markets/DecisionTrailCard"
import { LiveAgentLeaderboard } from "@/components/layouts/markets/LiveAgentLeaderboard"
import { type AgentJoinAvailability } from "@/components/layouts/markets/MarketJoinAvailabilityCard"
import { MarketLiveSync } from "@/components/layouts/markets/MarketLiveSync"
import { MarketNewsSection } from "@/components/layouts/markets/MarketNewsSection"
import { MarketOnchainCard } from "@/components/layouts/markets/MarketOnchainCard"
import { MarketTimingCard } from "@/components/layouts/markets/MarketTimingCard"
import { MarketTransparencyCard } from "@/components/layouts/markets/MarketTransparencyCard"
import { MarketWalletContext } from "@/components/layouts/markets/MarketWalletContext"
import { ParticipatingAgentsCard } from "@/components/layouts/markets/ParticipatingAgentsCard"
import { Stake } from "@/components/layouts/markets/Stake"
import { UserTimeZoneProvider } from "@/components/time/UserTimeZoneProvider"
import {
  formatCurrency,
  formatStatusLabel,
} from "@/components/layouts/markets/market-detail-helpers"
import { ResolutionPanel } from "@/components/markets/ResolutionPanel"
import { BattlePoolBreakdownCard } from "@/components/markets/BattlePoolBreakdownCard"
import { MarketJoinBattlePanel } from "@/components/markets/MarketJoinBattlePanel"
import { BattleTaskCard } from "@/components/markets/BattleTaskCard"
import { BattleTimeline } from "@/components/markets/BattleTimeline"
import { PredictionPreview } from "@/components/markets/PredictionPreview"
import { Badge } from "@/components/ui/badge"
import { NumberTicker } from "@/components/ui/number-ticker"
import { Separator } from "@/components/ui/separator"
import type { MarketDetailResponse, MarketNewsResponse } from "@/hooks/Type"
import { buildMarketCompetitionEntries } from "@/lib/market-competition"
import {
  formatCountdown,
  isApiDateSameOrBeforeNow,
} from "@/lib/time-formatters"

type MarketPageProps = {
  params: Promise<{
    slug: string
  }>
}

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? process.env.NEXT_PUBLIC_URL

const getAgentJoinAvailability = (
  market: MarketDetailResponse["data"]["market"]
): AgentJoinAvailability => {
  if (market.status === "upcoming") {
    return {
      canJoin: false,
      opensAt: market.timing.opens_at,
      title: "AI Agent entry is not open yet.",
      variant: "upcoming",
    }
  }

  if (market.status !== "open") {
    return {
      canJoin: false,
      title: "AI Agent entry is locked.",
      variant: "closed",
    }
  }

  if (isApiDateSameOrBeforeNow(market.timing.join_deadline_at)) {
    return {
      canJoin: false,
      joinDeadlineAt: market.timing.join_deadline_at,
      title: "AI Agent entry is locked.",
      variant: "deadline_passed",
    }
  }

  return {
    canJoin: true,
    joinCountdown: formatCountdown(market.timing.join_deadline_at),
    joinDeadlineAt: market.timing.join_deadline_at,
    title: "Do you have an AI Agent?",
    variant: "open",
  }
}

const getMarketDetail = async (slug: string) => {
  if (!API_BASE_URL) {
    throw new Error("API base URL is not configured")
  }

  const response = await fetch(
    `${API_BASE_URL}/v1/markets/${encodeURIComponent(slug)}`,
    {
      cache: "no-store",
    }
  )

  if (response.status === 404) {
    notFound()
  }

  if (!response.ok) {
    throw new Error(`Failed to load market detail: ${response.status}`)
  }

  return (await response.json()) as MarketDetailResponse
}

const getMarketNews = async (slug: string) => {
  if (!API_BASE_URL) {
    throw new Error("API base URL is not configured")
  }

  const response = await fetch(
    `${API_BASE_URL}/v1/markets/${encodeURIComponent(slug)}/news`,
    {
      cache: "no-store",
    }
  )

  if (response.status === 404) {
    notFound()
  }

  if (!response.ok) {
    throw new Error(`Failed to load market news: ${response.status}`)
  }

  return (await response.json()) as MarketNewsResponse
}

export default async function MarketPage({ params }: MarketPageProps) {
  const { slug } = await params
  const [marketDetail, marketNewsResponse] = await Promise.all([
    getMarketDetail(slug),
    getMarketNews(slug),
  ])
  const market = marketDetail.data.market
  const agents = marketDetail.data.agents
  const monitoring = marketDetail.data.monitoring
  const decisionTrail = marketDetail.data.ai_decision_trail
  const marketNews = marketNewsResponse.data
  const battleEntries = marketDetail.data.battle_entries
  const battlePool = marketDetail.data.battle_pool
  const liquidityValue = Number(market.settlement.total_liquidity_usdc ?? "0")
  const countdownValue = formatCountdown(market.timing.closes_at)
  const agentJoinAvailability = getAgentJoinAvailability(market)
  const competitionEntries = buildMarketCompetitionEntries(
    agents,
    decisionTrail
  )
  const competitionEntryById = new Map(
    competitionEntries.map((entry) => [entry.marketAgentId, entry])
  )
  const visibleCompetitionEntries = competitionEntries.filter(
    (entry) => entry.currentYesProbability !== null
  )
  const decisionEventCount = competitionEntries.reduce(
    (total, entry) => total + entry.points.length,
    0
  )

  return (
    <UserTimeZoneProvider>
      <main className="mx-4 space-y-8 pb-10 md:mx-10 xl:mx-20">
        <MarketLiveSync marketIdOrSlug={market.slug} />
        <Link
          href="/"
          className="inline-flex text-sm font-medium text-neutral-600 transition hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-neutral-50"
        >
          Back to all markets
        </Link>

        <section className="grid gap-8 lg:grid-cols-[340px_1fr]">
          <div className="space-y-5">
            <BattleCard
              title={market.title}
              badgeLabel={formatStatusLabel(market.status)}
              endsIn={countdownValue}
              liquidity={formatCurrency(
                market.settlement.total_liquidity_usdc,
                market.settlement.asset
              )}
              description={market.short_description}
              imageUri={market.image_uri}
              categoryLabel={market.category.name}
              topicLabels={market.topics.map((topic) => topic.name)}
            />
            <div className="space-y-3">
              <MarketJoinBattlePanel
                availability={agentJoinAvailability}
                battleEntries={battleEntries}
                battlePool={battlePool}
                marketIdOrSlug={market.slug}
                marketPubkey={market.onchain.market_pubkey}
                joinDeadlineAt={market.timing.join_deadline_at}
                settlementAsset={market.settlement.asset}
              />
            </div>
            <Separator />
            <Stake
              agents={agents}
              market={market}
              userContext={marketDetail.data.user_context}
            />

            <MarketTransparencyCard transparency={market.transparency} />
          </div>
          <div className="space-y-5">
            <p className="text-sm font-medium text-neutral-500 uppercase">
              Market Detail
            </p>
            <h1 className="mt-2 text-3xl font-semibold">{market.title}</h1>
            <p className="mt-3 max-w-2xl text-neutral-600 dark:text-neutral-400">
              {market.description}
            </p>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary" className="rounded">
                {market.category.name}
              </Badge>
              {market.topics.map((topic) => (
                <Badge key={topic.id} variant="outline" className="rounded">
                  {topic.name}
                </Badge>
              ))}
            </div>
            <div className="flex flex-wrap gap-10">
              <article>
                <p className="text-sm text-neutral-500">Liquidity</p>
                <div>
                  <NumberTicker
                    value={liquidityValue}
                    className="mt-2 text-xl font-semibold tracking-tighter whitespace-pre-wrap text-black dark:text-white"
                  />{" "}
                  {market.settlement.asset}
                </div>
              </article>
              <article>
                <p className="text-sm text-neutral-500">Ends In</p>
                <CountdownProgress
                  key={market.slug}
                  initialTime={countdownValue}
                />
              </article>
              <article>
                <p className="text-sm text-neutral-500">Status</p>
                <p className="mt-2 text-xl font-semibold">
                  {formatStatusLabel(market.status)}
                </p>
              </article>
            </div>
            <MarketNewsSection
              fallbackCategoryName={market.category.name}
              marketNews={marketNews}
            />
            <Curve
              entries={competitionEntries}
              marketTitle={market.title}
              liveDecisionsVisible={
                market.fairness.live_agent_decisions_visible
              }
              liveDecisionsVisibleAt={
                market.fairness.live_agent_decisions_visible_at
              }
            />
            <section className="grid grid-cols-3 gap-5">
              <BattleTaskCard
                market={market}
                transparency={market.transparency}
              />
              <BattlePoolBreakdownCard
                pool={battlePool}
                settlementAsset={market.settlement.asset}
              />
              <BattleTimeline status={market.status} timing={market.timing} />
            </section>

            <section className="grid grid-cols-3 gap-5">
              <MarketTimingCard timing={market.timing} />
              <ResolutionPanel market={market} agents={agents} />
              <MarketOnchainCard
                onchain={market.onchain}
                settlement={market.settlement}
              />
            </section>
            <section className="grid grid-cols-3 gap-5">
              <MarketActivityCard
                decisionEventCount={decisionEventCount}
                monitoring={monitoring}
                settlementAsset={market.settlement.asset}
                trackedAgentsCount={competitionEntries.length}
                visibleCompetitionEntriesCount={
                  visibleCompetitionEntries.length
                }
              />

              <LiveAgentLeaderboard
                entries={competitionEntries}
                liveDecisionsVisible={
                  market.fairness.live_agent_decisions_visible
                }
                liveDecisionsVisibleAt={
                  market.fairness.live_agent_decisions_visible_at
                }
                settlementAsset={market.settlement.asset}
              />
              <MarketWalletContext slug={market.slug} />
            </section>

            <section className="grid grid-cols-2 gap-5">
              <ParticipatingAgentsCard
                agents={agents}
                competitionEntryById={competitionEntryById}
                marketSlug={market.slug}
                settlementAsset={market.settlement.asset}
              />
              <DecisionTrailCard decisionTrail={decisionTrail} />
            </section>

            <section className="grid gap-5">
              <div>
                <p className="text-sm font-medium text-neutral-500 uppercase">
                  Submitted Predictions
                </p>
                <h2 className="mt-2 text-2xl font-semibold">
                  Locked battle entries
                </h2>
              </div>
              {battleEntries.length ? (
                <div className="grid gap-4 xl:grid-cols-2">
                  {battleEntries.map((entry) => (
                    <PredictionPreview
                      key={entry.id}
                      entry={entry}
                      settlementAsset={market.settlement.asset}
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-black/10 p-5 text-sm text-neutral-500 dark:border-white/10 dark:text-neutral-400">
                  No submitted predictions yet.
                </div>
              )}
            </section>
          </div>
        </section>
      </main>
    </UserTimeZoneProvider>
  )
}
