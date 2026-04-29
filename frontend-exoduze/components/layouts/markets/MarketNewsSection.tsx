import Link from "next/link"

import { MarketImage } from "@/components/MarketImage"
import { LocalizedDateTimeText } from "@/components/time/LocalizedTime"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import type { MarketNewsResponse } from "@/hooks/Type"

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

  return (
    <section className="space-y-3">
      <p className="text-sm font-medium text-neutral-500 uppercase">
        Market News
      </p>
      <ScrollArea className="w-full">
        <div className="grid w-max auto-cols-[320px] grid-flow-col gap-5 pb-4">
          {marketNews.slice(0, 4).map((item) => (
            <Link
              href={item.url}
              key={item.id}
              target="_blank"
              className="block"
            >
              <article className="grid gap-3 rounded border border-black/10 bg-white/70 p-3 transition-colors hover:bg-secondary dark:border-white/10 dark:bg-white/5">
                <MarketImage
                  src={item.image_uri}
                  alt={item.title}
                  label={item.category?.name ?? fallbackCategoryName}
                  className="aspect-video rounded"
                />
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3 text-xs text-neutral-500">
                    <span>{item.source.name}</span>
                    <span>
                      <LocalizedDateTimeText value={item.published_at} />
                    </span>
                  </div>
                  <h2 className="line-clamp-2 text-sm font-semibold">
                    {item.title}
                  </h2>
                  {item.summary ? (
                    <p className="line-clamp-2 text-sm text-neutral-600 dark:text-neutral-400">
                      {item.summary}
                    </p>
                  ) : null}
                </div>
              </article>
            </Link>
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </section>
  )
}
