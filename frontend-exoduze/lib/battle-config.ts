import type {
  AgentDataFocus,
  AgentRiskProfile,
  AgentSpecialization,
  BattleEntry,
  BattlePool,
  BattleStrategyPreset,
} from "@/hooks/Type"

export type StrategyWeights = {
  technicalWeight: number
  newsWeight: number
  sentimentWeight: number
  macroWeight: number
  onchainWeight: number
}

export const AGENT_SPECIALIZATION_OPTIONS: AgentSpecialization[] = [
  "crypto",
  "finance",
  "sports",
  "politics",
  "tech",
  "general",
]

export const AGENT_RISK_PROFILE_OPTIONS: AgentRiskProfile[] = [
  "conservative",
  "balanced",
  "aggressive",
]

export const AGENT_DATA_FOCUS_OPTIONS: AgentDataFocus[] = [
  "price_action",
  "news",
  "sentiment",
  "macro",
  "onchain",
  "technical",
]

export const AGENT_VISIBILITY_OPTIONS = ["public", "private"] as const

export const STRATEGY_PRESET_OPTIONS: BattleStrategyPreset[] = [
  "conservative",
  "aggressive",
  "momentum",
  "mean_reversion",
  "news_driven",
  "hybrid",
]

export const STRATEGY_PRESET_WEIGHTS: Record<
  BattleStrategyPreset,
  StrategyWeights
> = {
  conservative: {
    technicalWeight: 20,
    newsWeight: 20,
    sentimentWeight: 10,
    macroWeight: 35,
    onchainWeight: 15,
  },
  aggressive: {
    technicalWeight: 30,
    newsWeight: 15,
    sentimentWeight: 20,
    macroWeight: 10,
    onchainWeight: 25,
  },
  momentum: {
    technicalWeight: 40,
    newsWeight: 15,
    sentimentWeight: 20,
    macroWeight: 5,
    onchainWeight: 20,
  },
  mean_reversion: {
    technicalWeight: 35,
    newsWeight: 10,
    sentimentWeight: 15,
    macroWeight: 20,
    onchainWeight: 20,
  },
  news_driven: {
    technicalWeight: 10,
    newsWeight: 40,
    sentimentWeight: 20,
    macroWeight: 20,
    onchainWeight: 10,
  },
  hybrid: {
    technicalWeight: 20,
    newsWeight: 20,
    sentimentWeight: 20,
    macroWeight: 20,
    onchainWeight: 20,
  },
}

const WEIGHT_KEYS: Array<keyof StrategyWeights> = [
  "technicalWeight",
  "newsWeight",
  "sentimentWeight",
  "macroWeight",
  "onchainWeight",
]

export function createDefaultStrategyWeights(
  preset: BattleStrategyPreset = "hybrid"
) {
  return { ...STRATEGY_PRESET_WEIGHTS[preset] }
}

export function sumWeights(weights: StrategyWeights) {
  return WEIGHT_KEYS.reduce((total, key) => total + weights[key], 0)
}

export function rebalanceWeights(
  weights: StrategyWeights,
  changedKey: keyof StrategyWeights,
  nextValue: number
) {
  const clampedValue = clamp(Math.round(nextValue), 0, 100)
  const nextWeights = { ...weights, [changedKey]: clampedValue }
  const otherKeys = WEIGHT_KEYS.filter((key) => key !== changedKey)
  const remaining = 100 - clampedValue
  const currentOtherTotal = otherKeys.reduce(
    (total, key) => total + weights[key],
    0
  )

  if (currentOtherTotal <= 0) {
    const baseShare = Math.floor(remaining / otherKeys.length)
    let extra = remaining - baseShare * otherKeys.length

    for (const key of otherKeys) {
      nextWeights[key] = baseShare + (extra > 0 ? 1 : 0)
      if (extra > 0) {
        extra -= 1
      }
    }

    return nextWeights
  }

  for (const key of otherKeys) {
    const rawShare = (weights[key] / currentOtherTotal) * remaining
    nextWeights[key] = Math.max(0, Math.floor(rawShare))
  }

  let remainder =
    100 -
    WEIGHT_KEYS.reduce((total, key) => total + nextWeights[key], 0)

  const sortedKeys = [...otherKeys].sort((left, right) => {
    return weights[right] - weights[left]
  })

  while (remainder !== 0) {
    for (const key of sortedKeys) {
      if (remainder === 0) {
        break
      }

      if (remainder > 0) {
        nextWeights[key] += 1
        remainder -= 1
        continue
      }

      if (nextWeights[key] > 0) {
        nextWeights[key] -= 1
        remainder += 1
      }
    }
  }

  return nextWeights
}

export function formatPresetLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

export function formatDataFocusLabel(value: string) {
  return formatPresetLabel(value)
}

export function formatSpecializationLabel(value?: string | null) {
  return value ? formatPresetLabel(value) : "General"
}

export function formatRiskProfileLabel(value?: string | null) {
  return value ? formatPresetLabel(value) : "Balanced"
}

export function getDefaultDataFocusForSpecialization(
  specialization: AgentSpecialization
) {
  switch (specialization) {
    case "crypto":
      return ["price_action", "onchain", "technical"] as AgentDataFocus[]
    case "finance":
      return ["macro", "news", "technical"] as AgentDataFocus[]
    case "sports":
      return ["sentiment", "news", "technical"] as AgentDataFocus[]
    case "politics":
      return ["news", "macro", "sentiment"] as AgentDataFocus[]
    case "tech":
      return ["news", "sentiment", "technical"] as AgentDataFocus[]
    case "general":
    default:
      return ["news", "sentiment", "macro"] as AgentDataFocus[]
  }
}

export function getAgentInitials(name: string) {
  const parts = name
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)

  return (parts[0]?.[0] ?? "A") + (parts[1]?.[0] ?? "")
}

export function buildEstimatedPayouts(pool: BattlePool, stakeAmount: string) {
  const stake = Number(stakeAmount)

  if (!Number.isFinite(stake) || stake <= 0) {
    return []
  }

  const totalLockedStake = Number(pool.total_staked_usdc)

  return ["yes", "no"].map((direction) => {
    const currentSideStake =
      Number(
        pool.pools.find((item) => item.direction.toLowerCase() === direction)
          ?.total_stake_usdc ?? "0"
      ) || 0
    const sideStakeAfter = currentSideStake + stake
    const totalAfter = totalLockedStake + stake
    const grossEstimate =
      sideStakeAfter <= 0 ? stake : (stake / sideStakeAfter) * totalAfter

    return {
      direction,
      grossEstimate: Number(grossEstimate.toFixed(2)),
      sideStakeAfter: Number(sideStakeAfter.toFixed(2)),
    }
  })
}

export function findExistingBattleEntry(
  battleEntries: BattleEntry[],
  agentId: string
) {
  return battleEntries.find((entry) => entry.agent.id === agentId) ?? null
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}
