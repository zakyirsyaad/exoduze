export const agentSpecializations = [
  "crypto",
  "finance",
  "sports",
  "politics",
  "tech",
  "general",
] as const;

export const riskProfiles = [
  "conservative",
  "balanced",
  "aggressive",
] as const;

export const dataFocusOptions = [
  "price_action",
  "news",
  "sentiment",
  "macro",
  "onchain",
  "technical",
] as const;

export const visibilityOptions = ["public", "private"] as const;

export const strategyPresets = [
  "conservative",
  "aggressive",
  "momentum",
  "mean_reversion",
  "news_driven",
  "hybrid",
] as const;

export type AgentSpecialization = (typeof agentSpecializations)[number];
export type RiskProfile = (typeof riskProfiles)[number];
export type DataFocus = (typeof dataFocusOptions)[number];
export type AgentVisibility = (typeof visibilityOptions)[number];
export type StrategyPreset = (typeof strategyPresets)[number];

export type BattleSignalWeights = {
  technicalWeight: number;
  newsWeight: number;
  sentimentWeight: number;
  macroWeight: number;
  onchainWeight: number;
};

export const strategyPresetWeights: Record<StrategyPreset, BattleSignalWeights> =
  {
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
  };

export function getDefaultDataFocus(
  specialization: AgentSpecialization,
): DataFocus[] {
  switch (specialization) {
    case "crypto":
      return ["price_action", "onchain", "technical"];
    case "finance":
      return ["macro", "news", "technical"];
    case "sports":
      return ["sentiment", "news", "technical"];
    case "politics":
      return ["news", "macro", "sentiment"];
    case "tech":
      return ["news", "sentiment", "technical"];
    case "general":
    default:
      return ["news", "sentiment", "macro"];
  }
}

export function getDefaultCategorySlugsForSpecialization(
  specialization: AgentSpecialization,
) {
  return [specialization === "general" ? "general" : specialization];
}

export function getDefaultBasePersonality(
  specialization: AgentSpecialization,
) {
  switch (specialization) {
    case "crypto":
      return "Fast-moving, thesis-driven, and comfortable weighing volatility against conviction.";
    case "finance":
      return "Measured, analytical, and focused on disciplined market interpretation.";
    case "sports":
      return "Competitive, adaptive, and tuned to momentum swings and event context.";
    case "politics":
      return "Context-aware, skeptical, and focused on narrative shifts and real-world incentives.";
    case "tech":
      return "Curious, forward-looking, and attentive to product catalysts and execution risk.";
    case "general":
    default:
      return "Calm, analytical, and disciplined when evaluating market evidence.";
  }
}

export function getDefaultBaseStrategy(
  specialization: AgentSpecialization,
) {
  switch (specialization) {
    case "crypto":
      return "Blend market structure, on-chain flow, and catalyst timing before taking conviction.";
    case "finance":
      return "Balance macro regime, headline catalysts, and price confirmation before sizing conviction.";
    case "sports":
      return "Lean on momentum, event context, and sentiment shifts while avoiding overreaction.";
    case "politics":
      return "Cross-check narratives against incentives, timing, and durable evidence before locking a stance.";
    case "tech":
      return "Weigh adoption signals, execution quality, and sentiment before expressing conviction.";
    case "general":
    default:
      return "Blend structured signal analysis with measured conviction and risk control.";
  }
}

export function sumBattleWeights(weights: BattleSignalWeights) {
  return (
    weights.technicalWeight +
    weights.newsWeight +
    weights.sentimentWeight +
    weights.macroWeight +
    weights.onchainWeight
  );
}
