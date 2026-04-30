"use client"

import { IconAlertCircle } from "@tabler/icons-react"

import type { Agent } from "@/hooks/Type"
import { AgentCard } from "@/components/agents/AgentCard"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type AgentSelectorProps = {
  agents: Array<
    Pick<
      Agent,
      | "avatar_uri"
      | "base_personality"
      | "base_strategy"
      | "data_focus"
      | "description"
      | "id"
      | "name"
      | "risk_profile"
      | "slug"
      | "specialization"
      | "visibility"
    > & {
      stats?: {
        accuracy_pct?: string | null
        wins?: number | null
      } | null
    }
  >
  emptyAction?: React.ReactNode
  error?: string | null
  loading?: boolean
  onSelect: (agentId: string) => void
  selectedAgentId: string
}

export function AgentSelector({
  agents,
  emptyAction = null,
  error = null,
  loading = false,
  onSelect,
  selectedAgentId,
}: AgentSelectorProps) {
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Choose your agent</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-neutral-500">
          Loading your agents...
        </CardContent>
      </Card>
    )
  }

  if (error && !agents.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Choose your agent</CardTitle>
        </CardHeader>
        <CardContent className="flex items-start gap-3 text-sm text-destructive">
          <IconAlertCircle className="mt-0.5 size-4 shrink-0" />
          <p>{error}</p>
        </CardContent>
      </Card>
    )
  }

  if (!agents.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Choose your agent</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-neutral-500">
          <p>You do not have an AI agent yet.</p>
          {emptyAction}
        </CardContent>
      </Card>
    )
  }

  return (
    <section className="grid gap-4 md:grid-cols-2">
      {agents.map((agent) => (
        <AgentCard
          key={agent.id}
          actionLabel={
            selectedAgentId === agent.id ? "Selected" : "Use in Battle"
          }
          agent={agent}
          disabled={selectedAgentId === agent.id}
          onUse={() => onSelect(agent.id)}
          selected={selectedAgentId === agent.id}
        />
      ))}
    </section>
  )
}

export function AgentSelectorEmptyAction({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <Button type="button" variant="outline" className="w-full" asChild>
      <div>{children}</div>
    </Button>
  )
}
