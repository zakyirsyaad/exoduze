import type {
  MarketAgent,
  MarketDecisionSide,
  MarketDecisionTrailItem,
} from "@/hooks/Type"
import { getApiDateTimestamp } from "@/lib/time-formatters"

const AGENT_SERIES_COLORS = [
  "#2563eb",
  "#16a34a",
  "#ea580c",
  "#7c3aed",
  "#dc2626",
  "#0891b2",
  "#ca8a04",
  "#db2777",
] as const

export type MarketCompetitionPoint = {
  recordedAt: string
  sequenceNo: number
  side: MarketDecisionSide
  confidence: number
  yesProbability: number
  noProbability: number
}

export type MarketCompetitionEntry = {
  key: string
  color: string
  rank: number
  marketAgentId: string
  agentId: string
  agentSlug: string
  agentName: string
  agentDescription: string
  avatarUri: string | null
  versionLabel: string
  modelProvider: string
  modelName: string
  joinedAt: string
  followerCount: number
  followerStakedUsdc: string
  supportSharePct: number
  currentDecision: MarketAgent["current_decision"]
  currentYesProbability: number | null
  currentNoProbability: number | null
  resolvedMarkets: number | null
  accuracyPct: string | null
  currentStreak: number | null
  points: MarketCompetitionPoint[]
}

export function buildMarketCompetitionEntries(
  agents: MarketAgent[],
  decisionTrail: MarketDecisionTrailItem[]
) {
  const trailByMarketAgentId = new Map<string, MarketDecisionTrailItem[]>()

  for (const event of decisionTrail) {
    const existing = trailByMarketAgentId.get(event.market_agent_id)

    if (existing) {
      existing.push(event)
      continue
    }

    trailByMarketAgentId.set(event.market_agent_id, [event])
  }

  const entries = agents.map((agent) => {
    const events = [
      ...(trailByMarketAgentId.get(agent.market_agent_id) ?? []),
    ].sort((left, right) => {
      const leftTimestamp = getApiDateTimestamp(left.decided_at)
      const rightTimestamp = getApiDateTimestamp(right.decided_at)
      const timeDelta = compareTimestamps(leftTimestamp, rightTimestamp)

      if (timeDelta !== 0) {
        return timeDelta
      }

      return left.sequence_no - right.sequence_no
    })

    const points = events.map((event) => {
      const yesProbability = toYesProbability(
        event.decision_side,
        event.confidence
      )

      return {
        recordedAt: event.decided_at,
        sequenceNo: event.sequence_no,
        side: event.decision_side,
        confidence: roundToSingleDecimal(event.confidence * 100),
        yesProbability,
        noProbability: roundToSingleDecimal(100 - yesProbability),
      }
    })

    const currentYesProbability = agent.current_decision
      ? toYesProbability(
          agent.current_decision.side,
          agent.current_decision.confidence
        )
      : null
    const normalizedPoints =
      points.length > 0 || !agent.current_decision
        ? points
        : [
            {
              recordedAt: agent.current_decision.decided_at,
              sequenceNo: 1,
              side: agent.current_decision.side,
              confidence: roundToSingleDecimal(
                agent.current_decision.confidence * 100
              ),
              yesProbability: currentYesProbability ?? 50,
              noProbability: roundToSingleDecimal(
                100 - (currentYesProbability ?? 50)
              ),
            },
          ]

    return {
      key: "",
      color: "",
      rank: 0,
      marketAgentId: agent.market_agent_id,
      agentId: agent.agent.id,
      agentSlug: agent.agent.slug,
      agentName: agent.agent.name,
      agentDescription: agent.agent.description,
      avatarUri: agent.agent.avatar_uri,
      versionLabel: agent.locked_version.version_label,
      modelProvider: agent.locked_version.model_provider,
      modelName: agent.locked_version.model_name,
      joinedAt: agent.locked_version.joined_at,
      followerCount: agent.market_stats.follower_count,
      followerStakedUsdc: agent.market_stats.follower_staked_usdc,
      supportSharePct: roundToSingleDecimal(
        agent.market_stats.support_share_pct
      ),
      currentDecision: agent.current_decision,
      currentYesProbability,
      currentNoProbability:
        currentYesProbability === null
          ? null
          : roundToSingleDecimal(100 - currentYesProbability),
      resolvedMarkets: agent.stats?.resolved_markets ?? null,
      accuracyPct: agent.stats?.accuracy_pct ?? null,
      currentStreak: agent.stats?.current_streak ?? null,
      points: normalizedPoints,
    }
  })

  const rankedEntries = [...entries].sort(compareCompetitionEntries)

  return rankedEntries.map((entry, index) => ({
    ...entry,
    key: `agent_${index + 1}`,
    color: AGENT_SERIES_COLORS[index % AGENT_SERIES_COLORS.length],
    rank: index + 1,
  }))
}

function compareCompetitionEntries(
  left: MarketCompetitionEntry,
  right: MarketCompetitionEntry
) {
  const followerStakeDelta =
    parseNumericValue(right.followerStakedUsdc) -
    parseNumericValue(left.followerStakedUsdc)

  if (followerStakeDelta !== 0) {
    return followerStakeDelta
  }

  if (right.followerCount !== left.followerCount) {
    return right.followerCount - left.followerCount
  }

  const confidenceDelta =
    (right.currentDecision?.confidence ?? -1) -
    (left.currentDecision?.confidence ?? -1)

  if (confidenceDelta !== 0) {
    return confidenceDelta
  }

  return compareTimestamps(
    getApiDateTimestamp(left.joinedAt),
    getApiDateTimestamp(right.joinedAt)
  )
}

function toYesProbability(side: MarketDecisionSide, confidence: number) {
  const normalizedConfidence = clamp(confidence, 0, 1)
  const yesProbability =
    side === "YES"
      ? normalizedConfidence * 100
      : (1 - normalizedConfidence) * 100

  return roundToSingleDecimal(yesProbability)
}

function parseNumericValue(value?: string | null) {
  const numericValue = Number(value ?? "0")

  return Number.isFinite(numericValue) ? numericValue : 0
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max))
}

function roundToSingleDecimal(value: number) {
  return Math.round(value * 10) / 10
}

function compareTimestamps(
  leftTimestamp: number | null,
  rightTimestamp: number | null
) {
  if (leftTimestamp === rightTimestamp) {
    return 0
  }

  if (leftTimestamp === null) {
    return 1
  }

  if (rightTimestamp === null) {
    return -1
  }

  return leftTimestamp - rightTimestamp
}
