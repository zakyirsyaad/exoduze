"use client"
import Topics from "@/components/Topics"
import { BattleCard } from "@/components/BattleCard"
import { Skeleton } from "@/components/ui/skeleton"
import Link from "next/link"
import { useApi } from "@/hooks/useApi"
import { MarketsResponse } from "@/hooks/Type"
import {
  formatMarketEndsIn,
  formatMarketLiquidity,
  formatMarketStatusLabel,
} from "@/lib/market-formatters"
import React from "react"

export default function AllMarket() {
  const { data, get, loading, error } = useApi<MarketsResponse>()

  React.useEffect(() => {
    void get("/v1/markets")
  }, [get])

  const markets = data?.data ?? []
  const marketSkeletonItems = Array.from({ length: 5 })

  return (
    <div className="space-y-3">
      <Topics />
      <section className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {loading && !markets.length
          ? marketSkeletonItems.map((_, idx) => (
            <article
              key={`market-skeleton-${idx}`}
              className="w-full max-w-[340px] rounded-xl border border-black/10 bg-white/80 p-6 dark:border-white/10 dark:bg-white/5"
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <Skeleton className="h-6 w-20 rounded" />
                  <Skeleton className="h-4 w-16" />
                </div>
                <div className="space-y-2">
                  <Skeleton className="h-6 w-full" />
                  <Skeleton className="h-6 w-4/5" />
                </div>
                <div className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Skeleton className="h-5 w-20 rounded" />
                  <Skeleton className="h-5 w-16 rounded" />
                  <Skeleton className="h-5 w-14 rounded" />
                </div>
                <Skeleton className="h-5 w-32" />
              </div>
            </article>
          ))
          : markets.map((market) => (
            <Link href={`/markets/${market.slug}`} key={market.slug}>
              <BattleCard
                title={market.title}
                badgeLabel={formatMarketStatusLabel(market.status)}
                endsIn={formatMarketEndsIn(market.timing.closes_at)}
                liquidity={formatMarketLiquidity(
                  market.liquidity.total_liquidity_usdc
                )}
                description={market.short_description}
                imageUri={market.image_uri}
                categoryLabel={market.category.name}
                topicLabels={market.topics.map((topic) => topic.name)}
              />
            </Link>
          ))}
      </section>
      {error && !markets.length ? (
        <p className="text-sm text-red-500">Failed to load markets: {error}</p>
      ) : null}
    </div>
  )
}
