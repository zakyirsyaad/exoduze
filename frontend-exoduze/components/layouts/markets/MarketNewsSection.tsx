import Link from "next/link"

import { MarketImage } from "@/components/MarketImage"
import { LocalizedDateTimeText } from "@/components/time/LocalizedTime"
import { Marquee } from "@/components/ui/marquee"
import type { MarketNewsResponse, NewsItem } from "@/hooks/Type"
import { cn } from "@/lib/utils"

type MarketNewsSectionProps = {
  fallbackCategoryName: string
  marketNews: MarketNewsResponse["data"]
}

export function MarketNewsSection({
  fallbackCategoryName,
  marketNews,
}: MarketNewsSectionProps) {
  if (!marketNews.length) {
    return null
  }

  const splitIndex = Math.ceil(marketNews.length / 2)
  const firstRow = marketNews.slice(0, splitIndex)
  const secondRow = marketNews.slice(splitIndex)

  return (
    <section className="max-w-full min-w-0 space-y-3 overflow-hidden">
      <p className="text-sm font-medium text-neutral-500 uppercase">
        Market News
      </p>
      <div className="relative flex w-full max-w-full min-w-0 flex-col items-center justify-center overflow-hidden">
        <Marquee pauseOnHover className="[--duration:20s]">
          {firstRow.map((item) => (
            <NewsCard
              key={item.id}
              fallbackCategoryName={fallbackCategoryName}
              item={item}
            />
          ))}
        </Marquee>
        {secondRow.length ? (
          <Marquee reverse pauseOnHover className="[--duration:20s]">
            {secondRow.map((item) => (
              <NewsCard
                key={item.id}
                fallbackCategoryName={fallbackCategoryName}
                item={item}
              />
            ))}
          </Marquee>
        ) : null}
        <div className="pointer-events-none absolute inset-y-0 left-0 w-1/4 bg-gradient-to-r from-background"></div>
        <div className="pointer-events-none absolute inset-y-0 right-0 w-1/4 bg-gradient-to-l from-background"></div>
      </div>
    </section>
  )
}

function NewsCard({
  fallbackCategoryName,
  item,
}: {
  fallbackCategoryName: string
  item: NewsItem
}) {
  return (
    <Link
      href={item.url}
      target="_blank"
      rel="noreferrer"
      className="block h-full"
    >
      <figure
        className={cn(
          "relative grid h-full w-72 grid-cols-[72px_minmax(0,1fr)] gap-3 overflow-hidden rounded-xl border p-3 transition-colors",
          "border-black/10 bg-white/80 hover:bg-black/[0.03]",
          "dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
        )}
      >
        <div className="h-16 w-[72px] overflow-hidden rounded-lg">
          <MarketImage
            src={item.image_uri}
            alt={item.title}
            label={item.category?.name ?? fallbackCategoryName}
          />
        </div>
        <figcaption className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] font-medium text-neutral-500">
            <span className="max-w-28 truncate">{item.source.name}</span>
            <span aria-hidden="true">/</span>
            <LocalizedDateTimeText
              className="min-w-0 truncate"
              value={item.published_at}
            />
          </div>
          <p className="mt-1 line-clamp-2 text-sm leading-5 font-semibold">
            {item.title}
          </p>
          <p className="mt-1 line-clamp-2 text-xs leading-4 text-neutral-500">
            {item.summary ?? item.category?.name ?? fallbackCategoryName}
          </p>
        </figcaption>
      </figure>
    </Link>
  )
}
