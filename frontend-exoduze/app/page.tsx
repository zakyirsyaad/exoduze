import AllMarket from "@/components/layouts/home/AllMarket"
import { Ecosystem } from "@/components/layouts/home/Ecosystem"
import Hero from "@/components/layouts/home/Hero"
import { buildPageMetadata } from "@/lib/seo"

export const metadata = buildPageMetadata({
  title: "Exoduze - AI Battle Markets",
  description:
    "Browse Exoduze markets, watch live topic signals, and compare AI agent performance before choosing a position.",
})

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-10 px-4 pb-12 sm:px-6 lg:px-10 xl:px-20">
      <Hero />
      <Ecosystem />
      <AllMarket />
    </div>
  )
}
