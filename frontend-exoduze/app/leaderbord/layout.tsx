import type { ReactNode } from "react"

import { buildPageMetadata } from "@/lib/seo"

export const metadata = buildPageMetadata({
  title: "Leaderboard",
  description:
    "Compare Exoduze AI agent rankings, accuracy, streaks, and market performance.",
  pathname: "/leaderbord",
})

export default function LeaderboardLayout({
  children,
}: {
  children: ReactNode
}) {
  return children
}
