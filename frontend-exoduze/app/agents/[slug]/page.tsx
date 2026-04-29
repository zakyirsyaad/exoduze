import Link from "next/link"
import { notFound } from "next/navigation"

import { AgentManagementPanel } from "@/components/agents/AgentManagementPanel"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { Agent, AgentStats, PageInfo } from "@/hooks/Type"
import { formatSlugLabel } from "@/lib/market-formatters"

type AgentDetailPageProps = {
  params: Promise<{
    slug: string
  }>
}

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? process.env.NEXT_PUBLIC_URL

type AgentDetail = Omit<
  Agent,
  "activity" | "avatar_uri" | "categories" | "owner"
> & {
  activity?: Agent["activity"]
  avatar_uri?: string | null
  categories?: Agent["categories"]
  owner?: Agent["owner"]
  stats?: AgentStats | null
}

type AgentsListResponse = {
  data:
    | AgentDetail[]
    | {
        agents?: AgentDetail[]
        items?: AgentDetail[]
        page_info?: PageInfo
      }
  page_info?: PageInfo
}

const getAgentDetail = async (slug: string) => {
  if (!API_BASE_URL) {
    throw new Error("API base URL is not configured")
  }

  const response = await fetch(`${API_BASE_URL}/v1/agents?limit=100`, {
    cache: "no-store",
  })

  if (!response.ok) {
    throw new Error(`Failed to load agent detail: ${response.status}`)
  }

  const agentsResponse = (await response.json()) as AgentsListResponse
  const agent = getAgentsPayload(agentsResponse).find(
    (item) => item.slug === slug
  )

  if (!agent) {
    notFound()
  }

  return agent
}

export default async function AgentDetailPage({
  params,
}: AgentDetailPageProps) {
  const { slug } = await params
  const agent = await getAgentDetail(slug)
  const categories = agent.categories ?? []
  const ownerWallet = agent.owner?.wallet_address

  return (
    <main className="mx-4 space-y-8 py-10 md:mx-10 xl:mx-20">
      <Link
        href="/agents"
        className="inline-flex text-sm font-medium text-neutral-600 transition hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-neutral-50"
      >
        Back to agents
      </Link>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle>{agent.name || formatSlugLabel(slug)}</CardTitle>
              <CardDescription>@{agent.slug}</CardDescription>
            </div>
            <Badge
              variant={agent.status === "active" ? "secondary" : "outline"}
              className="w-fit rounded"
            >
              {agent.status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-6 text-sm">
          <p className="max-w-3xl leading-6 text-neutral-600 dark:text-neutral-400">
            {agent.description || "No public description yet."}
          </p>

          <div className="flex flex-wrap gap-2">
            {categories.length ? (
              categories.map((category) => (
                <Badge
                  key={`${agent.id}-${category.slug}`}
                  variant={category.is_primary ? "default" : "outline"}
                  className="rounded"
                >
                  {category.name}
                </Badge>
              ))
            ) : (
              <Badge variant="outline" className="rounded">
                Uncategorized
              </Badge>
            )}
          </div>

          <div className="grid gap-4 rounded-lg border border-black/10 p-4 md:grid-cols-2 dark:border-white/10">
            <div>
              <p className="text-neutral-500">Owner</p>
              {ownerWallet ? (
                <Link
                  href={`/owners/${encodeURIComponent(ownerWallet)}`}
                  className="mt-1 inline-flex font-mono text-xs break-all text-neutral-700 underline-offset-4 hover:underline dark:text-neutral-300"
                >
                  {ownerWallet}
                </Link>
              ) : (
                <p className="mt-1 font-mono text-xs break-all">N/A</p>
              )}
            </div>
            <div>
              <p className="text-neutral-500">Active Markets</p>
              <p className="mt-1 font-medium">
                {agent.activity?.active_markets_count ?? 0}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <AgentManagementPanel agent={agent} />
    </main>
  )
}

function getAgentsPayload(response: AgentsListResponse) {
  if (Array.isArray(response.data)) {
    return response.data
  }

  return response.data.agents ?? response.data.items ?? []
}
