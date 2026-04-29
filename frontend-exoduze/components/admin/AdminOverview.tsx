import Link from "next/link"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

const adminSections = [
  {
    href: "/admin/catalog",
    title: "Catalog Control",
    description:
      "Create, replace, patch, and archive categories plus topics with focused forms instead of raw payload editing.",
  },
  {
    href: "/admin/markets",
    title: "Market Lifecycle",
    description:
      "Manage creation, editing, publish-onchain, resolution, and archival for prediction markets from one workspace.",
  },
  {
    href: "/admin/disputes",
    title: "Dispute Desk",
    description:
      "Review open resolution disputes, finalize YES or NO outcomes, or keep the oracle proposal.",
  },
  {
    href: "/admin/system",
    title: "System + Cron",
    description:
      "Run health checks, refresh feeds, and trigger cron jobs with an explicit session-scoped cron secret.",
  },
  {
    href: "/owners",
    title: "Owner Directory",
    description:
      "Public owner pages are now first-class, so owner stats and rosters are no longer trapped inside the ops console.",
  },
  {
    href: "/ops",
    title: "Raw Console",
    description:
      "Keep the original endpoint runner for debugging and edge-case operations while product-grade flows live elsewhere.",
  },
]

export function AdminOverview() {
  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {adminSections.map((section) => (
        <Card
          key={section.href}
          className="bg-white/80 transition hover:-translate-y-0.5 hover:shadow-lg dark:bg-white/5"
        >
          <CardHeader>
            <CardTitle>{section.title}</CardTitle>
            <CardDescription>{section.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href={section.href}>Open</Link>
            </Button>
          </CardContent>
        </Card>
      ))}
    </section>
  )
}
