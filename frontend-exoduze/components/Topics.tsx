"use client"
import Link from "next/link"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import type { TrendingTopicsResponse } from "@/hooks/Type"
import { useApi } from "@/hooks/useApi"
import React from "react"

export default function Topics() {
  const {
    data: hotTopicsData,
    get: getTopics,
    loading: loadingTopics,
    error: errorTopics,
  } = useApi<TrendingTopicsResponse>()

  React.useEffect(() => {
    void getTopics("/v1/feed/hot-topics")
  }, [getTopics])

  const categorySlug = hotTopicsData?.data?.category?.slug ?? null
  const topics = hotTopicsData?.data?.topics ?? []
  const topicSkeletonItems = Array.from({ length: 6 })
  const categoryHref = categorySlug ? `/${categorySlug}` : "/"
  const topicItems = [
    {
      id: "topic-trending",
      name: "Trending",
      href: categoryHref,
    },
    ...topics.map((item) => ({
      id: item.id,
      name: item.name,
      href: categorySlug ? `/${categorySlug}/${item.slug}` : categoryHref,
    })),
  ]

  return (
    <section className="w-full">
      <ScrollArea className="w-full whitespace-nowrap">
        <div className="flex w-max p-4 pl-0">
          {loadingTopics && !topics.length
            ? topicSkeletonItems.map((_, idx) => (
                <Skeleton
                  key={`topic-skeleton-${idx}`}
                  className={`mr-2 h-10 shrink-0 rounded ${idx === 0 ? "w-24" : "w-28"}`}
                />
              ))
            : topicItems.map((item) => (
                <Link
                  key={item.id}
                  href={item.href}
                  className={`shrink-0 rounded px-5 py-2 text-sm duration-300 ${
                    item.name === "Trending"
                      ? "bg-black text-white hover:bg-neutral-800 dark:bg-white dark:text-black dark:hover:bg-neutral-200"
                      : "text-neutral-600 hover:bg-secondary dark:text-neutral-300"
                  }`}
                >
                  <span className="block text-center">{item.name}</span>
                </Link>
              ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
      {errorTopics && !topics.length ? (
        <p className="pt-2 text-sm text-red-500">
          Failed to load topics: {errorTopics}
        </p>
      ) : null}
    </section>
  )
}
