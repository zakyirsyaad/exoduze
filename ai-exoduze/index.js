import { createHash } from "node:crypto";

export const aiDecisionJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "decision_side",
    "confidence",
    "reason_summary",
    "key_signals",
    "risk_factors",
  ],
  properties: {
    decision_side: {
      type: "string",
      enum: ["yes", "no", "abstain"],
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
    },
    reason_summary: {
      type: "string",
    },
    key_signals: {
      type: "array",
      maxItems: 8,
      items: {
        type: "string",
      },
    },
    risk_factors: {
      type: "array",
      maxItems: 8,
      items: {
        type: "string",
      },
    },
  },
};

export function canonicalizeJson(value) {
  return JSON.stringify(normalizeValue(value));
}

export function hashCanonicalJson(value) {
  return `0x${createHash("sha256").update(canonicalizeJson(value)).digest("hex")}`;
}

export class AiDecisionService {
  constructor(env) {
    this.env = env;
    this.promptBuilder = new AiPromptBuilder(env);
    this.provider = this.createProvider();
  }

  async generateDecision(input) {
    const prompt = this.promptBuilder.buildDecisionPrompt(input);
    const result = await this.provider.decide(prompt);

    return {
      provider: this.provider.name,
      model: this.provider.model,
      prompt,
      decision: result.decision,
      reasonHash: hashCanonicalJson({
        decision: result.decision,
        prompt_hash: prompt.promptHash,
        model: this.provider.model,
      }),
      rawResponse: result.rawResponse,
    };
  }

  createProvider() {
    if (this.env.AI_DECISION_PROVIDER === "openai") {
      return new OpenAiDecisionProvider(this.env);
    }

    return new HeuristicDecisionProvider();
  }
}

export class AiPromptBuilder {
  constructor(env) {
    this.env = env;
  }

  buildDecisionPrompt(input) {
    const now = input.now ?? new Date().toISOString();
    const canonicalizationVersion = this.env.AI_CANONICALIZATION_VERSION;
    const snapshotPayload = {
      now,
      market: input.market,
      agent: {
        id: input.agent.id,
        slug: input.agent.slug,
        name: input.agent.name,
        description: input.agent.description,
        categories: input.agent.categories,
      },
      user_prompt: input.userPrompt ?? null,
      news: input.news,
    };
    const runtimeConfig = {
      provider: this.env.AI_DECISION_PROVIDER,
      model: this.env.OPENAI_MODEL,
      max_output_tokens: this.env.OPENAI_DECISION_MAX_OUTPUT_TOKENS,
      schema: "exoduze.agent_market_decision.v1",
    };
    const systemPrompt = [
      "You are an Exoduze prediction-market AI agent.",
      "Your job is to decide the likely outcome of a market using only the provided market, agent, and evidence context.",
      "Return a calibrated decision, not financial advice.",
      "Use 'abstain' when evidence is too weak, contradictory, or unrelated.",
      "Keep the reason summary concise and audit-friendly.",
    ].join("\n");
    const userPrompt = [
      "Evaluate this market and produce a JSON decision that follows the provided schema.",
      "",
      "Decision rules:",
      "- decision_side must be 'yes', 'no', or 'abstain'.",
      "- confidence must be between 0 and 1.",
      "- key_signals should list evidence that supports the decision.",
      "- risk_factors should list uncertainty and counterarguments.",
      "",
      input.userPrompt
        ? `User strategy prompt:\n${input.userPrompt}`
        : "User strategy prompt: none",
      "",
      `Canonical context:\n${canonicalizeJson(snapshotPayload)}`,
    ].join("\n");
    const payload = {
      canonicalization_version: canonicalizationVersion,
      runtime_config: runtimeConfig,
      system_prompt: systemPrompt,
      user_prompt: userPrompt,
      snapshot: snapshotPayload,
    };
    const promptText = `${systemPrompt}\n\n${userPrompt}`;

    return {
      canonicalizationVersion,
      systemPrompt,
      userPrompt,
      payload,
      promptText,
      promptHash: hashCanonicalJson(payload),
      configHash: hashCanonicalJson(runtimeConfig),
      snapshotHash: hashCanonicalJson(snapshotPayload),
    };
  }
}

export class HeuristicDecisionProvider {
  name = "heuristic";
  model = "exoduze-heuristic-v1";

  async decide(prompt) {
    const text = prompt.promptText.toLowerCase();
    const yesSignals = countMatches(text, [
      "approval",
      "launch",
      "pass",
      "growth",
      "beat",
      "record",
      "up",
      "surge",
    ]);
    const noSignals = countMatches(text, [
      "delay",
      "reject",
      "miss",
      "down",
      "drop",
      "lawsuit",
      "risk",
      "cut",
    ]);
    const difference = yesSignals - noSignals;
    const decision_side =
      difference > 1 ? "yes" : difference < -1 ? "no" : "abstain";
    const confidence =
      decision_side === "abstain"
        ? 0.45
        : Math.min(0.8, 0.55 + Math.abs(difference) * 0.05);
    const decision = validateDecisionResponse({
      decision_side,
      confidence,
      reason_summary:
        "Heuristic development fallback used because no live AI provider was selected. Treat this as a placeholder decision only.",
      key_signals: [
        `positive_keyword_count=${yesSignals}`,
        `negative_keyword_count=${noSignals}`,
      ],
      risk_factors: [
        "No model inference was performed.",
        "Keyword matching cannot evaluate nuanced market evidence.",
      ],
    });

    return {
      decision,
      rawResponse: {
        provider: this.name,
        yesSignals,
        noSignals,
      },
    };
  }
}

export class OpenAiDecisionProvider {
  name = "openai";

  constructor(env) {
    this.env = env;
    this.model = env.OPENAI_MODEL;
  }

  async decide(prompt) {
    if (!this.env.OPENAI_API_KEY) {
      throw new Error(
        "OPENAI_API_KEY must be configured to use OpenAI decisions.",
      );
    }

    const response = await fetch(`${this.env.OPENAI_BASE_URL}/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: this.model,
        max_output_tokens: this.env.OPENAI_DECISION_MAX_OUTPUT_TOKENS,
        input: [
          {
            role: "system",
            content: prompt.systemPrompt,
          },
          {
            role: "user",
            content: prompt.userPrompt,
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "agent_market_decision",
            strict: true,
            schema: aiDecisionJsonSchema,
          },
        },
      }),
    });

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(
        `OpenAI decision request failed with HTTP ${response.status}.`,
      );
    }

    const outputText = extractOutputText(body);
    if (!outputText) {
      throw new Error("OpenAI returned an empty decision response.");
    }

    return {
      decision: validateDecisionResponse(JSON.parse(outputText)),
      rawResponse: body,
    };
  }
}

function validateDecisionResponse(value) {
  if (!value || typeof value !== "object") {
    throw new Error("AI decision response must be an object.");
  }

  const decision = value;
  const allowedKeys = new Set([
    "decision_side",
    "confidence",
    "reason_summary",
    "key_signals",
    "risk_factors",
  ]);
  const unexpectedKeys = Object.keys(decision).filter(
    (key) => !allowedKeys.has(key),
  );
  if (unexpectedKeys.length) {
    throw new Error(
      `AI decision response contains unsupported fields: ${unexpectedKeys.join(", ")}.`,
    );
  }

  if (!["yes", "no", "abstain"].includes(decision.decision_side)) {
    throw new Error("AI decision_side must be yes, no, or abstain.");
  }

  if (
    typeof decision.confidence !== "number" ||
    decision.confidence < 0 ||
    decision.confidence > 1
  ) {
    throw new Error("AI confidence must be between 0 and 1.");
  }

  if (
    typeof decision.reason_summary !== "string" ||
    decision.reason_summary.length < 1 ||
    decision.reason_summary.length > 1200
  ) {
    throw new Error("AI reason_summary is invalid.");
  }

  const keySignals = validateStringList(decision.key_signals, "key_signals");
  const riskFactors = validateStringList(decision.risk_factors, "risk_factors");

  return {
    decision_side: decision.decision_side,
    confidence: decision.confidence,
    reason_summary: decision.reason_summary,
    key_signals: keySignals,
    risk_factors: riskFactors,
  };
}

function validateStringList(value, label) {
  if (!Array.isArray(value) || value.length > 8) {
    throw new Error(`AI ${label} must be an array with at most 8 items.`);
  }

  return value.map((item) => {
    if (typeof item !== "string" || item.length < 1) {
      throw new Error(`AI ${label} must contain only non-empty strings.`);
    }

    return item;
  });
}

function extractOutputText(response) {
  if (response?.output_text) {
    return response.output_text;
  }

  for (const output of response?.output ?? []) {
    for (const content of output.content ?? []) {
      if (content.type === "output_text" && content.text) {
        return content.text;
      }
    }
  }

  return null;
}

function countMatches(text, tokens) {
  return tokens.reduce(
    (count, token) => count + (text.includes(token) ? 1 : 0),
    0,
  );
}

function normalizeValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeValue(entry));
  }

  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .reduce((accumulator, key) => {
        const normalized = normalizeValue(value[key]);
        if (normalized !== undefined) {
          accumulator[key] = normalized;
        }

        return accumulator;
      }, {});
  }

  return value;
}
