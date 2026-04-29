import Link from "next/link"
import { notFound } from "next/navigation"

import { BattleCard } from "@/components/BattleCard"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { CategoryPageResponse } from "@/hooks/Type"
import {
  formatMarketEndsIn,
  formatMarketLiquidity,
  formatMarketStatusLabel,
  formatSlugLabel,
} from "@/lib/market-formatters"

type TopicPageProps = {
  params: Promise<{
    categories: string
    topics: string
  }>
}

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? process.env.NEXT_PUBLIC_URL

const getTopicPage = async (categorySlug: string, topicSlug: string) => {
  if (!API_BASE_URL) {
    throw new Error("API base URL is not configured")
  }

  const response = await fetch(
    `${API_BASE_URL}/v1/categories/${encodeURIComponent(
      categorySlug
    )}?topic=${encodeURIComponent(topicSlug)}`,
    {
      cache: "no-store",
    }
  )

  if (response.status === 404) {
    notFound()
  }

  if (!response.ok) {
    throw new Error(`Failed to load topic: ${response.status}`)
  }

  return (await response.json()) as CategoryPageResponse
}

export default async function TopicPage({ params }: TopicPageProps) {
  const { categories: categorySlug, topics: topicSlug } = await params
  const topicResponse = await getTopicPage(categorySlug, topicSlug)
  const { category, filters, topics, markets } = topicResponse.data
  const selectedTopic = filters.selected_topic

  return (
    <main className="mx-4 space-y-8 py-10 md:mx-10 xl:mx-20">
      <Link
        href={`/${category.slug}`}
        className="inline-flex text-sm font-medium text-neutral-600 transition hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-neutral-50"
      >
        Back to {category.name}
      </Link>

      <section className="space-y-4">
        <p className="text-sm font-medium text-neutral-500 uppercase">Topic</p>
        <h1 className="text-3xl font-semibold">
          {selectedTopic?.name ?? formatSlugLabel(topicSlug)}
        </h1>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary" className="rounded">
            {category.name}
          </Badge>
          <Badge variant="outline" className="rounded">
            {markets.length} markets
          </Badge>
        </div>
      </section>

      {topics.length ? (
        <section className="flex flex-wrap gap-2">
          {topics.map((topic) => (
            <Link href={`/${category.slug}/${topic.slug}`} key={topic.id}>
              <Badge
                variant={topic.slug === topicSlug ? "secondary" : "outline"}
                className="rounded"
              >
                {topic.name} - {topic.market_count}
              </Badge>
            </Link>
          ))}
        </section>
      ) : null}

      {markets.length ? (
        <section className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {markets.map((market) => (
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
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>No Topic Markets Yet</CardTitle>
            <CardDescription>
              There are no markets linked to{" "}
              {selectedTopic?.name ?? formatSlugLabel(topicSlug)} right now.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-neutral-600 dark:text-neutral-400">
            Try another topic or return to {category.name}.
          </CardContent>
        </Card>
      )}
    </main>
  )
}
