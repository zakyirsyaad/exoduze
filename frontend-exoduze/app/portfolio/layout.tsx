import type { ReactNode } from "react"

import { buildPageMetadata } from "@/lib/seo"

export const metadata = buildPageMetadata({
  title: "Portfolio",
  description:
    "Review Exoduze wallet balances, market positions, AI battles, and payout claim status.",
  pathname: "/portfolio",
})

export default function PortfolioLayout({ children }: { children: ReactNode }) {
  return children
}
