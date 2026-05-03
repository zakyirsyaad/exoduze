import { createHash } from "node:crypto";

import { z } from "zod";

import type { Env } from "../../config/env.js";
import {
  AiDecisionService,
  hashCanonicalJson,
  type AiDecisionInput,
  type AiDecisionRuntimeConfig,
} from "../../../ai-exoduze/index.js";
import type {
  AgentSpecialization,
  BattleSignalWeights,
  DataFocus,
  RiskProfile,
  StrategyPreset,
} from "./battle-config.js";

type BattlePredictionAgentIdentity = {
  id: string;
  name: string;
  specialization: AgentSpecialization;
  description: string;
  basePersonality: string;
  baseStrategy: string;
  riskProfile: RiskProfile;
  dataFocus: DataFocus[];
};

type BattlePredictionMarketContext = {
  id: string;
  slug: string;
  title: string;
  shortDescription: string;
  description: string;
  resolutionRule: string;
  scoringMethod: string;
  startTime: string;
  endTime: string;
};

type BattlePredictionStrategyInput = BattleSignalWeights & {
  preset: StrategyPreset;
  optionalInsight: string | null;
};

const battlePredictionJsonSchema = z
  .object({
    predictedValue: z.union([z.number().finite(), z.string().min(1).max(240)]),
    direction: z.enum(["bullish", "bearish", "neutral", "yes", "no"]),
    confidence: z.number().min(0).max(1),
    reasoningSummary: z.string().min(1).max(1200),
    riskNotes: z.string().min(1).max(1200),
  })
  .strict();

const aiDecisionResponseSchema = z
  .object({
    decision_side: z.enum(["yes", "no", "abstain"]),
    confidence: z.number().min(0).max(1),
    reason_summary: z.string().min(1).max(1200),
    key_signals: z.array(z.string().min(1).max(500)).max(8),
    risk_factors: z.array(z.string().min(1).max(500)).max(8),
  })
  .strict();

export type BattlePredictionJson = z.infer<typeof battlePredictionJsonSchema>;

type BattlePredictionPrompt = {
  canonicalizationVersion: string;
  configHash: string;
  payload: unknown;
  promptHash: string;
  snapshotHash: string;
  systemPrompt: string;
  userPrompt: string;
};

export type BattlePredictionResult = {
  provider: string;
  model: string;
  prediction: BattlePredictionJson;
  predictionHash: string;
  prompt: BattlePredictionPrompt;
  keySignals: string[];
  riskFactors: string[];
  reasonHash: string;
};

type GenerateBattlePredictionInput = {
  agent: BattlePredictionAgentIdentity;
  market: BattlePredictionMarketContext;
  strategy: BattlePredictionStrategyInput;
};

const SYSTEM_PROMPT = [
  "You are an AI prediction agent participating in a competitive prediction battle.",
  "You must follow your agent identity and selected battle strategy.",
  "Return only valid JSON matching the required schema.",
].join("\n");

const OUTPUT_SCHEMA = `{
  "predictedValue": number | string,
  "direction": "bullish" | "bearish" | "neutral" | "yes" | "no",
  "confidence": number,
  "reasoningSummary": string,
  "riskNotes": string
}`;

const PRESET_DIRECTION_BIAS: Record<StrategyPreset, number> = {
  conservative: 0,
  aggressive: 6,
  momentum: 8,
  mean_reversion: -5,
  news_driven: 4,
  hybrid: 2,
};

const RISK_PROFILE_CONFIDENCE_BIAS: Record<RiskProfile, number> = {
  conservative: -0.04,
  balanced: 0,
  aggressive: 0.04,
};

type BattlePredictionProvider = "mock" | "openai" | "openrouter";
type LiveBattlePredictionProvider = Exclude<BattlePredictionProvider, "mock">;

export class BattlePredictionService {
  constructor(private readonly env: Env) {}

  async generatePrediction(
    input: GenerateBattlePredictionInput,
  ): Promise<BattlePredictionResult> {
    const provider = this.resolvePredictionProvider();

    if (provider === "openai" || provider === "openrouter") {
      return this.generateAiProviderPrediction(input, provider);
    }

    return this.generateMockPredictionResult(input);
  }

  private generateMockPredictionResult(
    input: GenerateBattlePredictionInput,
  ): BattlePredictionResult {
    const prompt = this.buildPrompt(input);
    const prediction = this.generateMockPrediction(input);
    const predictionHash = hashCanonicalJson(prediction);
    const keySignals = buildKeySignals(input.strategy);
    const riskFactors = buildRiskFactors(input.agent, input.strategy);

    return {
      provider: "mock",
      model: "exoduze-battle-mock-v1",
      prediction,
      predictionHash,
      prompt,
      keySignals,
      riskFactors,
      reasonHash: hashCanonicalJson({
        prediction,
        prompt_hash: prompt.promptHash,
        model: "exoduze-battle-mock-v1",
      }),
    };
  }

  private async generateAiProviderPrediction(
    input: GenerateBattlePredictionInput,
    provider: LiveBattlePredictionProvider,
  ): Promise<BattlePredictionResult> {
    const aiDecisionService = new AiDecisionService(this.buildAiRuntimeConfig(provider));
    const aiDecision = await aiDecisionService.generateDecision(
      this.buildAiDecisionInput(input),
    );
    const decision = validateAiDecisionResponse(aiDecision.decision);
    const prediction = validateBattlePredictionJson({
      predictedValue:
        decision.decision_side === "abstain" ? "abstain" : decision.decision_side,
      direction: mapAiDecisionSideToBattleDirection(decision.decision_side),
      confidence: decision.confidence,
      reasoningSummary: decision.reason_summary,
      riskNotes: decision.risk_factors.length
        ? decision.risk_factors.join(" ")
        : "The model did not return specific risk factors.",
    });
    const predictionHash = hashCanonicalJson(prediction);

    return {
      provider: aiDecision.provider,
      model: aiDecision.model,
      prediction,
      predictionHash,
      prompt: aiDecision.prompt,
      keySignals: decision.key_signals,
      riskFactors: decision.risk_factors,
      reasonHash: hashCanonicalJson({
        prediction,
        prompt_hash: aiDecision.prompt.promptHash,
        model: aiDecision.model,
      }),
    };
  }

  private buildAiRuntimeConfig(
    provider: LiveBattlePredictionProvider,
  ): AiDecisionRuntimeConfig {
    return {
      AI_DECISION_PROVIDER: provider,
      AI_CANONICALIZATION_VERSION: this.env.AI_CANONICALIZATION_VERSION,
      OPENAI_API_KEY: this.env.OPENAI_API_KEY,
      OPENAI_BASE_URL: this.env.OPENAI_BASE_URL,
      OPENAI_MODEL: this.env.OPENAI_MODEL,
      OPENAI_DECISION_MAX_OUTPUT_TOKENS:
        this.env.OPENAI_DECISION_MAX_OUTPUT_TOKENS,
      OPENROUTER_API_KEY: this.env.OPENROUTER_API_KEY,
      OPENROUTER_BASE_URL: this.env.OPENROUTER_BASE_URL,
      OPENROUTER_MODEL: this.env.OPENROUTER_MODEL,
      OPENROUTER_DECISION_MAX_TOKENS:
        this.env.OPENROUTER_DECISION_MAX_TOKENS,
      OPENROUTER_SITE_URL: this.env.OPENROUTER_SITE_URL,
      OPENROUTER_APP_NAME: this.env.OPENROUTER_APP_NAME,
    };
  }

  private buildAiDecisionInput(
    input: GenerateBattlePredictionInput,
  ): AiDecisionInput {
    return {
      market: {
        id: input.market.id,
        slug: input.market.slug,
        title: input.market.title,
        shortDescription:
          input.market.shortDescription || input.market.title,
        description: input.market.description,
        categorySlug: input.agent.specialization,
        categoryName: formatPresetLabel(input.agent.specialization),
        status: "open",
        oracleSource: input.market.resolutionRule,
        opensAt: input.market.startTime,
        joinDeadlineAt: input.market.endTime,
        decisionCutoffAt: input.market.endTime,
        closesAt: input.market.endTime,
        topics: input.agent.dataFocus.map((focus) => ({
          slug: focus,
          name: formatPresetLabel(focus),
        })),
      },
      agent: {
        id: input.agent.id,
        slug: input.agent.id,
        name: input.agent.name,
        description: [
          input.agent.description,
          `Personality: ${input.agent.basePersonality}`,
          `Base strategy: ${input.agent.baseStrategy}`,
          `Risk profile: ${input.agent.riskProfile}`,
          `Battle specialization: ${input.agent.specialization}`,
        ].join("\n"),
        categories: [
          {
            slug: input.agent.specialization,
            name: formatPresetLabel(input.agent.specialization),
          },
        ],
      },
      userPrompt: buildBattleStrategyPrompt(input),
      news: [],
    };
  }

  private buildPrompt(input: GenerateBattlePredictionInput): BattlePredictionPrompt {
    const snapshot = {
      agent: input.agent,
      battle: input.market,
      strategy: input.strategy,
    };
    const runtimeConfig = {
      provider: "mock",
      model: "exoduze-battle-mock-v1",
      schema: "exoduze.battle_prediction.v1",
      max_output_tokens: this.env.OPENAI_DECISION_MAX_OUTPUT_TOKENS,
    };
    const userPrompt = [
      "AGENT IDENTITY:",
      `Name: ${input.agent.name}`,
      `Specialization: ${input.agent.specialization}`,
      `Personality: ${input.agent.basePersonality}`,
      `Base Strategy: ${input.agent.baseStrategy}`,
      `Risk Profile: ${input.agent.riskProfile}`,
      `Data Focus: ${input.agent.dataFocus.join(", ") || "none"}`,
      "",
      "BATTLE TASK:",
      `Title: ${input.market.title}`,
      `Market Question: ${input.market.shortDescription || input.market.title}`,
      `Resolution Rule: ${input.market.resolutionRule}`,
      `Time Window: ${input.market.startTime} to ${input.market.endTime}`,
      `Scoring Method: ${input.market.scoringMethod}`,
      "",
      "USER SELECTED STRATEGY:",
      `Preset: ${input.strategy.preset}`,
      "Weights:",
      `- Technical: ${input.strategy.technicalWeight}%`,
      `- News: ${input.strategy.newsWeight}%`,
      `- Sentiment: ${input.strategy.sentimentWeight}%`,
      `- Macro: ${input.strategy.macroWeight}%`,
      `- Onchain: ${input.strategy.onchainWeight}%`,
      `Optional Insight: ${input.strategy.optionalInsight || "none"}`,
      "",
      "OUTPUT JSON SCHEMA:",
      OUTPUT_SCHEMA,
      "",
      "Validation:",
      "- confidence must be between 0 and 1",
      "- reasoningSummary should be concise",
      "- no markdown in JSON response",
    ].join("\n");
    const payload = {
      canonicalization_version: this.env.AI_CANONICALIZATION_VERSION,
      runtime_config: runtimeConfig,
      system_prompt: SYSTEM_PROMPT,
      user_prompt: userPrompt,
      snapshot,
    };

    return {
      canonicalizationVersion: this.env.AI_CANONICALIZATION_VERSION,
      configHash: hashCanonicalJson(runtimeConfig),
      payload,
      promptHash: hashCanonicalJson(payload),
      snapshotHash: hashCanonicalJson(snapshot),
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
    };
  }

  private generateMockPrediction(
    input: GenerateBattlePredictionInput,
  ): BattlePredictionJson {
    const seed = [
      input.agent.id,
      input.market.id,
      input.strategy.preset,
      input.strategy.technicalWeight,
      input.strategy.newsWeight,
      input.strategy.sentimentWeight,
      input.strategy.macroWeight,
      input.strategy.onchainWeight,
      input.strategy.optionalInsight ?? "",
    ].join(":");
    const hash = createHash("sha256").update(seed).digest();
    const hashBias = (hash.readUInt16BE(0) % 17) - 8;
    const wordingBias = getQuestionWordingBias(
      `${input.market.title} ${input.market.shortDescription} ${input.market.description}`,
    );
    const focusBias =
      input.strategy.technicalWeight * 0.08 +
      input.strategy.newsWeight * 0.05 +
      input.strategy.sentimentWeight * 0.04 +
      input.strategy.macroWeight * 0.02 +
      input.strategy.onchainWeight * 0.06;
    const presetBias = PRESET_DIRECTION_BIAS[input.strategy.preset];
    const insightBias = input.strategy.optionalInsight
      ? ((hash.readUInt16BE(2) % 9) - 4)
      : 0;
    const rawScore =
      50 + presetBias + wordingBias + hashBias + focusBias + insightBias;
    const clampedProbability = clamp(rawScore, 18, 82);
    const confidence = clamp(
      0.56 +
        Math.abs(clampedProbability - 50) / 90 +
        RISK_PROFILE_CONFIDENCE_BIAS[input.agent.riskProfile],
      0.51,
      0.92,
    );
    const direction = clampedProbability >= 50 ? "yes" : "no";
    const predictedValue = Number(clampedProbability.toFixed(2));
    const dominantWeights = getDominantWeights(input.strategy);

    return validateBattlePredictionJson({
      predictedValue,
      direction,
      confidence: Number(confidence.toFixed(4)),
      reasoningSummary: `Mock battle prediction favors ${direction.toUpperCase()} because ${input.agent.name} leans on ${dominantWeights.join(", ")} under the ${formatPresetLabel(input.strategy.preset)} preset.`,
      riskNotes: `Deterministic placeholder output only. ${input.agent.riskProfile.charAt(0).toUpperCase()}${input.agent.riskProfile.slice(1)} risk profile and ${input.agent.specialization} specialization may overfit to limited structured inputs.`,
    });
  }

  private resolvePredictionProvider(): BattlePredictionProvider {
    const provider = this.env.AI_DECISION_PROVIDER;

    if (isProtectedRuntime()) {
      const configuredProvider = process.env.AI_DECISION_PROVIDER?.trim();
      if (
        !configuredProvider ||
        (provider !== "openai" && provider !== "openrouter")
      ) {
        throw new Error(
          "AI_DECISION_PROVIDER must be explicitly set to openai or openrouter for battle predictions in staging/production.",
        );
      }
    }

    if (provider === "openai") {
      return "openai";
    }

    if (provider === "openrouter") {
      return "openrouter";
    }

    if (provider === "mock") {
      if (!isLocalDevelopmentRuntime()) {
        throw new Error(
          "Mock battle predictions are only allowed in local/development/test runtimes.",
        );
      }

      return "mock";
    }

    throw new Error(
      "Battle predictions require AI_DECISION_PROVIDER=openai or openrouter, or AI_DECISION_PROVIDER=mock in local/development/test.",
    );
  }
}

function validateAiDecisionResponse(value: unknown) {
  return aiDecisionResponseSchema.parse(value);
}

function validateBattlePredictionJson(value: unknown): BattlePredictionJson {
  return battlePredictionJsonSchema.parse(value);
}

function mapAiDecisionSideToBattleDirection(
  value: z.infer<typeof aiDecisionResponseSchema>["decision_side"],
): BattlePredictionJson["direction"] {
  if (value === "yes" || value === "no") {
    return value;
  }

  return "neutral";
}

function buildBattleStrategyPrompt(input: GenerateBattlePredictionInput) {
  return [
    "Battle prediction mode. Take the selected battle strategy into account before choosing a side.",
    "",
    "Agent strategy:",
    `- Preset: ${input.strategy.preset}`,
    `- Technical weight: ${input.strategy.technicalWeight}%`,
    `- News weight: ${input.strategy.newsWeight}%`,
    `- Sentiment weight: ${input.strategy.sentimentWeight}%`,
    `- Macro weight: ${input.strategy.macroWeight}%`,
    `- On-chain weight: ${input.strategy.onchainWeight}%`,
    `- Optional insight: ${input.strategy.optionalInsight || "none"}`,
    "",
    "Market scoring:",
    input.market.scoringMethod,
    "",
    "Prefer yes/no when the evidence supports a stakeable prediction. Use abstain only when the evidence is too weak or contradictory.",
  ].join("\n");
}

function isProtectedRuntime() {
  return [
    process.env.APP_ENV,
    process.env.NODE_ENV,
    process.env.ENVIRONMENT,
    process.env.DEPLOY_ENV,
    process.env.VERCEL_ENV,
  ].some((value) => {
    const normalized = value?.trim().toLowerCase();
    return (
      normalized === "production" ||
      normalized === "prod" ||
      normalized === "staging" ||
      normalized === "stage"
    );
  });
}

function isLocalDevelopmentRuntime() {
  const values = [
    process.env.APP_ENV,
    process.env.NODE_ENV,
    process.env.ENVIRONMENT,
    process.env.DEPLOY_ENV,
    process.env.VERCEL_ENV,
  ].map((value) => value?.trim().toLowerCase()).filter(Boolean);

  if (values.length === 0) {
    return true;
  }

  return values.every(
    (value) =>
      value === "local" ||
      value === "development" ||
      value === "dev" ||
      value === "test",
  );
}

function buildKeySignals(strategy: BattlePredictionStrategyInput) {
  return [
    `preset=${strategy.preset}`,
    `technical=${strategy.technicalWeight}%`,
    `news=${strategy.newsWeight}%`,
    `sentiment=${strategy.sentimentWeight}%`,
    `macro=${strategy.macroWeight}%`,
    `onchain=${strategy.onchainWeight}%`,
  ];
}

function buildRiskFactors(
  agent: BattlePredictionAgentIdentity,
  strategy: BattlePredictionStrategyInput,
) {
  const factors = [
    "Mock prediction engine; replace with a live model before production use.",
    `${agent.riskProfile} risk profile may amplify preset bias.`,
  ];

  if (strategy.optionalInsight) {
    factors.push("Optional user insight can skew placeholder outputs.");
  }

  return factors;
}

function getDominantWeights(strategy: BattlePredictionStrategyInput) {
  const weights: Array<[string, number]> = [
    ["technical", strategy.technicalWeight],
    ["news", strategy.newsWeight],
    ["sentiment", strategy.sentimentWeight],
    ["macro", strategy.macroWeight],
    ["onchain", strategy.onchainWeight],
  ];

  return weights
    .sort((left, right) => right[1] - left[1])
    .slice(0, 2)
    .map(([label]) => label);
}

function getQuestionWordingBias(text: string) {
  const normalized = text.toLowerCase();
  const positiveWords = [
    "approval",
    "launch",
    "growth",
    "record",
    "surge",
    "rally",
    "beat",
  ];
  const negativeWords = [
    "ban",
    "delay",
    "drop",
    "miss",
    "reject",
    "fall",
    "lawsuit",
  ];

  return positiveWords.reduce(
    (total, keyword) => total + (normalized.includes(keyword) ? 2 : 0),
    0,
  ) -
    negativeWords.reduce(
      (total, keyword) => total + (normalized.includes(keyword) ? 2 : 0),
      0,
    );
}

function formatPresetLabel(value: string) {
  return value.replace(/_/g, " ");
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
