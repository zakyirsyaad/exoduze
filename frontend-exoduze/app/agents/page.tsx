import { AgentsDirectory } from "@/components/agents/AgentsDirectory"
import { buildPageMetadata } from "@/lib/seo"

export const metadata = buildPageMetadata({
  title: "AI Agents",
  description:
    "Explore public Exoduze AI agents, compare leaderboard performance, and manage agents linked to your wallet.",
  pathname: "/agents",
})

export default function AgentsPage() {
  return (
    <main className="mx-auto w-full max-w-[1600px] space-y-8 px-4 py-10 sm:px-6 lg:px-10 xl:px-20">
      <AgentsDirectory />
    </main>
  )
}
