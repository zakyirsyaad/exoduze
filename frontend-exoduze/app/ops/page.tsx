import Link from "next/link"

import { Button } from "@/components/ui/button"
import { OpsDashboard } from "@/components/ops/OpsDashboard"
import { buildPageMetadata } from "@/lib/seo"

export const metadata = buildPageMetadata({
  title: "Ops Console",
  description:
    "Use the Exoduze operations console for manual API checks and fallback admin workflows.",
  pathname: "/ops",
})

export default function OpsPage() {
  return (
    <main className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-10 sm:px-6 lg:px-10 xl:px-20">
      <section className="overflow-hidden rounded-[2rem] bg-gradient-to-br from-neutral-100 via-white to-slate-100 p-6 ring-1 ring-black/5 dark:from-neutral-900 dark:via-neutral-950 dark:to-slate-900 dark:ring-white/10">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold tracking-[0.3em] text-neutral-500 uppercase">
              Fallback Console
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
              Raw endpoint runner for edge cases and debugging.
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-6 text-neutral-600 dark:text-neutral-300">
              Dedicated flows for catalog, markets, disputes, system jobs, and
              owner pages now live in the product UI. Keep this console for
              manual testing when you need the underlying route surface.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/admin">Open Admin Suite</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/owners">Open Owners Directory</Link>
            </Button>
          </div>
        </div>
      </section>

      <OpsDashboard />
    </main>
  )
}
