import Link from "next/link"
import { notFound } from "next/navigation"

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"

type SnapshotPageProps = {
  params: Promise<{
    marketAgentId: string
    slug: string
  }>
}

type MarketAgentSnapshotResponse = {
  data: {
    market: {
      id: string
      slug: string
      title: string
    }
    market_agent: {
      id: string
      agent: {
        id: string
        slug: string
        name: string
      }
    }
    commitment: {
      snapshot_uri: string | null
      snapshot_hash: string | null
      hash_algo: string | null
      prompt_hash: string | null
      config_hash: string | null
      verification_status: string | null
      commit_tx_sig: string | null
      onchain_commitment_ref: string | null
    }
    artifact: {
      id: string | null
      artifact_hash: string | null
      canonicalization_version: string | null
      published_at: string | null
    }
    payload: unknown
  }
}

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? process.env.NEXT_PUBLIC_URL

async function getSnapshot(slug: string, marketAgentId: string) {
  if (!API_BASE_URL) {
    throw new Error("API base URL is not configured")
  }

  const response = await fetch(
    `${API_BASE_URL}/v1/markets/${encodeURIComponent(
      slug
    )}/agents/${encodeURIComponent(marketAgentId)}/snapshot`,
    { cache: "no-store" }
  )

  if (response.status === 404) {
    notFound()
  }

  if (!response.ok) {
    throw new Error(`Failed to load snapshot: ${response.status}`)
  }

  return (await response.json()) as MarketAgentSnapshotResponse
}

export default async function SnapshotPage({ params }: SnapshotPageProps) {
  const { slug, marketAgentId } = await params
  const snapshot = await getSnapshot(slug, marketAgentId)
  const { artifact, commitment, market, market_agent, payload } = snapshot.data

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground md:px-8">
      <div className="mx-auto grid max-w-5xl gap-6">
        <div className="flex flex-col gap-3">
          <Link
            href={`/markets/${encodeURIComponent(market.slug)}`}
            className="text-sm font-medium text-muted-foreground underline"
          >
            Back to market
          </Link>
          <div>
            <Badge variant="outline" className="rounded">
              {commitment.verification_status ?? "pending"}
            </Badge>
            <h1 className="mt-3 text-3xl font-semibold">Agent Snapshot</h1>
            <p className="mt-2 max-w-3xl text-muted-foreground">
              {market_agent.agent.name} on {market.title}
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Commitment</CardTitle>
            <CardDescription>
              Hashes and on-chain references for this market-agent snapshot.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 text-sm md:grid-cols-2">
              <SnapshotField label="Market Agent" value={market_agent.id} />
              <SnapshotField label="Artifact" value={artifact.id} />
              <SnapshotField label="Snapshot URI" value={commitment.snapshot_uri} />
              <SnapshotField label="Hash Algo" value={commitment.hash_algo} />
              <SnapshotField label="Snapshot Hash" value={commitment.snapshot_hash} />
              <SnapshotField label="Prompt Hash" value={commitment.prompt_hash} />
              <SnapshotField label="Config Hash" value={commitment.config_hash} />
              <SnapshotField
                label="Commitment Ref"
                value={commitment.onchain_commitment_ref}
              />
              <SnapshotField label="Commit Tx" value={commitment.commit_tx_sig} />
              <SnapshotField
                label="Canonicalization"
                value={artifact.canonicalization_version}
              />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payload</CardTitle>
            <CardDescription>
              Canonical context used to produce the AI decision.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Separator className="mb-4" />
            <pre className="max-h-[70vh] overflow-auto rounded-md border bg-muted/40 p-4 text-xs leading-6">
              {JSON.stringify(payload ?? null, null, 2)}
            </pre>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}

function SnapshotField({
  label,
  value,
}: {
  label: string
  value?: string | null
}) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-all font-mono text-xs">
        {value || "N/A"}
      </dd>
    </div>
  )
}
