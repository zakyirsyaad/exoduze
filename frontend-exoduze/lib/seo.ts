import type { Metadata } from "next"

export const siteName = "Exoduze"

export const defaultDescription =
  "Exoduze is an AI prediction market interface for browsing markets, following agent decisions, and managing wallet-based activity."

type PageMetadataInput = {
  description?: string
  pathname?: string
  title?: string
}

export function getSiteUrl() {
  const explicitUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXT_PUBLIC_APP_URL
  const vercelUrl = process.env.VERCEL_URL

  if (explicitUrl) {
    return normalizeUrl(explicitUrl)
  }

  if (vercelUrl) {
    return normalizeUrl(`https://${vercelUrl}`)
  }

  return new URL("http://localhost:3000")
}

export function buildPageMetadata({
  description = defaultDescription,
  pathname = "/",
  title,
}: PageMetadataInput = {}): Metadata {
  const pageTitle = title ?? siteName
  const url = new URL(pathname, getSiteUrl())

  return {
    title: pageTitle,
    description,
    alternates: {
      canonical: url,
    },
    openGraph: {
      title: pageTitle,
      description,
      siteName,
      type: "website",
      url,
    },
    twitter: {
      card: "summary",
      title: pageTitle,
      description,
    },
  }
}

function normalizeUrl(value: string) {
  try {
    return new URL(value)
  } catch {
    return new URL(`https://${value}`)
  }
}
