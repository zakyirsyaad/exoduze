export type AiDecisionSide = "yes" | "no" | "abstain";
export type AiDecisionProviderName = "heuristic" | "openai" | "openrouter";

export type AiDecisionRuntimeConfig = {
  AI_DECISION_PROVIDER: AiDecisionProviderName;
  AI_CANONICALIZATION_VERSION: string;
  OPENAI_API_KEY?: string | undefined;
  OPENAI_BASE_URL: string;
  OPENAI_MODEL: string;
  OPENAI_DECISION_MAX_OUTPUT_TOKENS: number;
  OPENROUTER_API_KEY?: string | undefined;
  OPENROUTER_BASE_URL?: string | undefined;
  OPENROUTER_MODEL?: string | undefined;
  OPENROUTER_DECISION_MAX_TOKENS?: number | undefined;
  OPENROUTER_SITE_URL?: string | undefined;
  OPENROUTER_APP_NAME?: string | undefined;
};

export type AiMarketContext = {
  id: string;
  slug: string;
  title: string;
  shortDescription: string;
  description: string;
  categorySlug: string;
  categoryName: string;
  status: string;
  oracleSource: string;
  opensAt: string;
  joinDeadlineAt: string;
  decisionCutoffAt: string;
  closesAt: string;
  resolvesAt?: string | null | undefined;
  topics: Array<{
    slug: string;
    name: string;
  }>;
};

export type AiAgentContext = {
  id: string;
  slug: string;
  name: string;
  description: string;
  categories: Array<{
    slug: string;
    name: string;
  }>;
  latestVersion?: {
    id: string;
    versionLabel: string;
    versionNo: number;
    modelProvider: string;
    modelName: string;
    runtimeConfig: unknown;
    configHash: string;
  } | null;
};

export type AiNewsContextItem = {
  title: string;
  summary?: string | null | undefined;
  url: string;
  sourceName: string;
  publishedAt: string;
  isBreaking: boolean;
};

export type AiDecisionInput = {
  market: AiMarketContext;
  agent: AiAgentContext;
  userPrompt?: string | null | undefined;
  news: AiNewsContextItem[];
  now?: string | undefined;
};

export type AiDecisionResponse = {
  decision_side: AiDecisionSide;
  confidence: number;
  reason_summary: string;
  key_signals: string[];
  risk_factors: string[];
};

export type AiPromptArtifact = {
  canonicalizationVersion: string;
  systemPrompt: string;
  userPrompt: string;
  payload: unknown;
  promptText: string;
  promptHash: string;
  configHash: string;
  snapshotHash: string;
};

export type AiDecisionResult = {
  provider: AiDecisionProviderName;
  model: string;
  prompt: AiPromptArtifact;
  decision: AiDecisionResponse;
  reasonHash: string;
  rawResponse: unknown;
};

export type AiDecisionProvider = {
  readonly name: AiDecisionProviderName;
  readonly model: string;
  decide(prompt: AiPromptArtifact): Promise<{
    decision: AiDecisionResponse;
    rawResponse: unknown;
  }>;
};

export declare const aiDecisionJsonSchema: unknown;
export declare function canonicalizeJson(value: unknown): string;
export declare function hashCanonicalJson(value: unknown): string;

export declare class AiDecisionService {
  constructor(env: AiDecisionRuntimeConfig);
  generateDecision(input: AiDecisionInput): Promise<AiDecisionResult>;
}

export declare class AiPromptBuilder {
  constructor(env: AiDecisionRuntimeConfig);
  buildDecisionPrompt(input: AiDecisionInput): AiPromptArtifact;
}

export declare class HeuristicDecisionProvider implements AiDecisionProvider {
  readonly name: "heuristic";
  readonly model: string;
  decide(prompt: AiPromptArtifact): Promise<{
    decision: AiDecisionResponse;
    rawResponse: unknown;
  }>;
}

export declare class OpenAiDecisionProvider implements AiDecisionProvider {
  readonly name: "openai";
  readonly model: string;
  constructor(env: AiDecisionRuntimeConfig);
  decide(prompt: AiPromptArtifact): Promise<{
    decision: AiDecisionResponse;
    rawResponse: unknown;
  }>;
}

export declare class OpenRouterDecisionProvider implements AiDecisionProvider {
  readonly name: "openrouter";
  readonly model: string;
  constructor(env: AiDecisionRuntimeConfig);
  decide(prompt: AiPromptArtifact): Promise<{
    decision: AiDecisionResponse;
    rawResponse: unknown;
  }>;
}
