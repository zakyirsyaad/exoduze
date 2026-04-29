"use client"

import { useState } from "react"

import { cn } from "@/lib/utils"

type MarketImageProps = {
  src?: string | null
  alt: string
  label?: string
  className?: string
  imageClassName?: string
}

export function MarketImage({
  src,
  alt,
  label,
  className,
  imageClassName,
}: MarketImageProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)

  if (src && failedSrc !== src) {
    return (
      <img
        src={src}
        alt={alt}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailedSrc(src)}
        className={cn("h-full w-full object-cover", className, imageClassName)}
      />
    )
  }

  return (
    <div
      role="img"
      aria-label={alt}
      className={cn(
        "flex h-full w-full items-center justify-center bg-neutral-950 p-4 text-center text-sm font-semibold text-white ring-1 ring-white/10",
        className
      )}
    >
      <span className="line-clamp-2">{label ?? "Market"}</span>
    </div>
  )
}
