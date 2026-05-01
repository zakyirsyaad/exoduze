"use client"

import Image from "next/image"
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
      <span className={cn("relative block h-full w-full", className)}>
        <Image
          src={src}
          alt={alt}
          fill
          unoptimized
          sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 340px"
          referrerPolicy="no-referrer"
          onError={() => setFailedSrc(src)}
          className={cn("object-cover", imageClassName)}
        />
      </span>
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
