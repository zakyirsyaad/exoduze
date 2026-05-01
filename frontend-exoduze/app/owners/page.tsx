import { OwnersDirectory } from "@/components/owners/OwnersDirectory"
import { buildPageMetadata } from "@/lib/seo"

export const metadata = buildPageMetadata({
  title: "Owner Directory",
  description:
    "Browse Exoduze wallet owners, public agent rosters, category coverage, and owner-level market activity.",
  pathname: "/owners",
})

export default function OwnersPage() {
  return (
    <main className="mx-auto w-full max-w-[1600px] space-y-8 px-4 py-10 sm:px-6 lg:px-10 xl:px-20">
      <OwnersDirectory />
    </main>
  )
}
