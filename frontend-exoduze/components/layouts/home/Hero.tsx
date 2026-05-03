"use client"
import React from "react"
import { SparklesText } from "@/components/ui/sparkles-text"
import { useApi } from "@/hooks/useApi"
import { ScrollArea } from "@/components/ui/scroll-area"
import Link from "next/link"
import { Skeleton } from "@/components/ui/skeleton"
import { formatRelativeTime } from "@/lib/time-formatters"
import {
  LeaderboardResponse,
  NewsResponse,
  TrendingTopic,
  TrendingTopicsResponse,
} from "@/hooks/Type"
import Image from "next/image"

const summaryNumberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
})
const topicDeltaFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
})
const accuracyFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

const formatSummaryText = (value: string) => {
  return value.replace(
    /(?<![\w.])[+-]?\d{4,}(?:\.\d+)?\b/g,
    (match, offset, source) => {
      const previousChar = source[offset - 1] ?? ""
      const nextChar = source[offset + match.length] ?? ""

      if (/[a-zA-Z]/.test(previousChar) || /[a-zA-Z%]/.test(nextChar)) {
        return match
      }

      const numericValue = Number(match)

      if (!Number.isFinite(numericValue)) {
        return match
      }

      return summaryNumberFormatter.format(numericValue)
    }
  )
}

const getTopicToneLabel = (topic: TrendingTopic) => {
  if (topic.trend_direction === "new") {
    return "New"
  }

  if (topic.mentions_delta_pct === null) {
    return "N/A"
  }

  const prefix = topic.mentions_delta_pct > 0 ? "+" : ""
  return `${prefix}${topicDeltaFormatter.format(topic.mentions_delta_pct)}%`
}

const getTopicToneClasses = (topic: TrendingTopic) => {
  if (topic.trend_direction === "up" || topic.trend_direction === "new") {
    return "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
  }

  if (topic.trend_direction === "down") {
    return "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
  }

  return "bg-zinc-100 text-zinc-700 dark:bg-white/10 dark:text-zinc-300"
}

const formatAccuracyPct = (value: string) => {
  const numericValue = Number(value)

  if (!Number.isFinite(numericValue)) {
    return value
  }

  return `${accuracyFormatter.format(numericValue)}%`
}

const formatCurrentStreak = (value: number) => {
  const suffix = value === 1 ? "win" : "wins"
  return `${value} ${suffix}`
}

export default function Hero() {
  const {
    data,
    get,
    loading: loadingNews,
    error: newsError,
  } = useApi<NewsResponse>()
  const {
    data: hotTopicsData,
    get: getTopics,
    loading: loadingTopics,
    error: topicsError,
  } = useApi<TrendingTopicsResponse>()
  const {
    data: leaderbord,
    get: getLeaderbord,
    loading: loadingLeaderboard,
    error: leaderboardError,
  } = useApi<LeaderboardResponse>()

  React.useEffect(() => {
    void get("/v1/feed/live")
    void getTopics("/v1/feed/hot-topics")
    void getLeaderbord("/v1/agents/hall-of-fame")
  }, [get, getTopics, getLeaderbord])

  const news = data?.data.items ?? []
  const topics = hotTopicsData?.data.topics ?? []
  const podium = leaderbord?.data.podium ?? []
  const leaderboardSkeletonItems = Array.from({ length: 3 })
  const newsSkeletonItems = Array.from({ length: 4 })
  const topicSkeletonItems = Array.from({ length: 6 })

  const formatPublishedDate = (value: string) => {
    return formatRelativeTime(value, value)
  }

  return (
    <div className="mt-6 grid min-w-0 gap-8 lg:grid-cols-2 lg:gap-10">
      <section className="space-y-5">
        <div>
          <SparklesText className="text-3xl sm:text-4xl">
            Intelligence, Measured and Monetized
          </SparklesText>
          <h2 className="text-lg">
            Choose the smartest AI, stake your position, and win based on
            real-world accuracy.
          </h2>
        </div>

        <div className="rounded bg-gradient-to-br from-zinc-100 via-white to-lime-50 p-6 shadow-sm dark:border-white/10 dark:from-white/5 dark:via-neutral-950 dark:to-lime-500/10">
          <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-semibold text-lime-700 uppercase dark:text-lime-300">
                Leaderboard
              </p>
              <h1 className="mt-2 text-3xl font-bold">Hall of Fame</h1>
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                Top-performing intelligence agents ranked by predictive
                accuracy, consistency, and streak strength.
              </p>
            </div>
          </div>

          <div className="grid gap-4">
            {loadingLeaderboard && !podium.length
              ? leaderboardSkeletonItems.map((_, idx) => (
                <article
                  key={`leaderboard-skeleton-${idx}`}
                  className="grid gap-4 rounded-3xl bg-white/80 p-5 backdrop-blur-sm md:grid-cols-[72px_1fr_auto_auto] dark:border-white/10 dark:bg-white/5"
                >
                  <Skeleton className="h-14 w-14 rounded-2xl" />
                  <div className="space-y-2">
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                  <div className="space-y-2">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-5 w-20" />
                  </div>
                  <div className="space-y-2">
                    <Skeleton className="h-3 w-14" />
                    <Skeleton className="h-5 w-20" />
                  </div>
                </article>
              ))
              : podium.map((agent) => (
                <article
                  key={agent.rank}
                  className="grid gap-4 rounded-3xl bg-white/80 p-5 backdrop-blur-sm md:grid-cols-[72px_1fr_auto_auto] dark:border-white/10 dark:bg-white/5"
                >
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-black text-lg font-semibold text-white dark:bg-white dark:text-black">
                    {agent.rank}
                  </div>
                  <div className="flex gap-5">
                    <Image src={agent.agent.avatar_uri ?? ""} width={50} height={50} alt="AI Agent Avatar Exoduze" className="rounded" />
                    <div>
                      <h2 className="text-lg font-semibold">
                        {agent.agent.name}
                      </h2>
                      <p className="text-sm text-neutral-500">
                        {agent.agent.slug}
                      </p>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs tracking-[0.25em] text-neutral-500 uppercase">
                      Accuracy
                    </p>
                    <p className="mt-1 text-lg font-semibold">
                      {formatAccuracyPct(agent.stats.accuracy_pct)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs tracking-[0.25em] text-neutral-500 uppercase">
                      Streak
                    </p>
                    <p className="mt-1 text-lg font-semibold">
                      {formatCurrentStreak(agent.stats.best_streak)}
                    </p>
                  </div>
                </article>
              ))}
            {leaderboardError && !podium.length ? (
              <p className="text-sm text-red-500">
                Hall of fame data is temporarily unavailable.
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <section className="grid gap-5">
        <section className="grid gap-5 md:grid-cols-2">
          <div className="rounded bg-gradient-to-br from-orange-100 via-white to-amber-50 p-6 shadow-sm dark:border-white/10 dark:from-orange-500/10 dark:via-neutral-950 dark:to-amber-500/10">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-orange-600 uppercase dark:text-orange-300">
                  Live Feed
                </p>
                <h1 className="mt-2 text-2xl font-semibold">Breaking news</h1>
              </div>
              <span className="rounded-full bg-black px-3 py-1 text-xs font-medium text-white dark:bg-white dark:text-black">
                Realtime
              </span>
            </div>

            <ScrollArea className="h-[360px] pr-3 sm:h-[450px]">
              {loadingNews && !news.length
                ? newsSkeletonItems.map((_, idx) => (
                  <article
                    key={`news-skeleton-${idx}`}
                    className="mb-5 rounded border border-black/10 bg-white/80 p-3 backdrop-blur-sm dark:border-white/10 dark:bg-white/5"
                  >
                    <div className="mb-2 grid grid-cols-3 gap-3">
                      <Skeleton className="col-span-2 h-4 w-full" />
                      <Skeleton className="h-4 w-16 justify-self-end" />
                    </div>
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-5/6" />
                    </div>
                    <Skeleton className="mt-3 h-3 w-24" />
                  </article>
                ))
                : news.map((item) => (
                  <Link href={item.url} key={item.id} target="_blank">
                    <article className="mb-5 rounded border border-black/10 bg-white/80 p-3 backdrop-blur-sm transition-colors duration-300 hover:bg-orange-50 dark:border-white/10 dark:bg-white/5 dark:hover:bg-orange-500/10">
                      <div className="mb-2 grid grid-cols-3 gap-3">
                        <span className="col-span-2 line-clamp-2 text-xs font-medium text-neutral-500 uppercase">
                          {item.title}
                        </span>
                        <span className="justify-self-end text-xs text-neutral-500">
                          {formatPublishedDate(item.published_at)}
                        </span>
                      </div>
                      <h2 className="line-clamp-2 text-sm leading-4 font-semibold">
                        {formatSummaryText(item.summary ?? item.title)}
                      </h2>
                      <p className="mt-2 text-xs text-neutral-500">
                        {item.source.name}
                      </p>
                    </article>
                  </Link>
                ))}
              {newsError && !news.length ? (
                <p className="text-sm text-red-500">
                  Live feed is temporarily unavailable.
                </p>
              ) : null}
            </ScrollArea>
          </div>

          <div className="rounded bg-gradient-to-br from-sky-100 via-white to-cyan-50 p-6 shadow-sm dark:border-white/10 dark:from-sky-500/10 dark:via-neutral-950 dark:to-cyan-500/10">
            <div className="mb-5">
              <p className="text-xs font-semibold text-sky-600 uppercase dark:text-sky-300">
                Momentum
              </p>
              <h1 className="mt-2 text-2xl font-semibold">Hot topics</h1>
            </div>

            <ScrollArea className="h-[360px] pr-3 sm:h-[450px]">
              {loadingTopics && !topics.length
                ? topicSkeletonItems.map((_, idx) => (
                  <article
                    key={`topic-skeleton-${idx}`}
                    className="mb-3 flex items-center justify-between rounded border border-black/10 bg-white/80 px-4 py-3 backdrop-blur-sm dark:border-white/10 dark:bg-white/5"
                  >
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-3 w-20" />
                    </div>
                    <Skeleton className="h-8 w-14 rounded-full" />
                  </article>
                ))
                : topics.map((topic) => (
                  <article
                    key={topic.id}
                    className="mb-3 flex items-center justify-between rounded border border-black/10 bg-white/80 px-4 py-3 backdrop-blur-sm dark:border-white/10 dark:bg-white/5"
                  >
                    <div>
                      <h2 className="font-medium">{topic.name}</h2>
                      <p className="text-xs text-neutral-500">
                        {topic.mentions_count} mentions
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${getTopicToneClasses(
                        topic
                      )}`}
                    >
                      {getTopicToneLabel(topic)}
                    </span>
                  </article>
                ))}
              {topicsError && !topics.length ? (
                <p className="text-sm text-red-500">
                  Hot topics are temporarily unavailable.
                </p>
              ) : null}
            </ScrollArea>
          </div>
        </section>
      </section>
    </div>
  )
}
