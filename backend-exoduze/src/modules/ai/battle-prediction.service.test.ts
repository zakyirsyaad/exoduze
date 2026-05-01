import assert from "node:assert/strict";
import test from "node:test";

import type { Env } from "../../config/env.js";
import { BattlePredictionService } from "./battle-prediction.service.js";

test("provider=openai uses AiDecisionService and does not call generateMockPrediction", async () => {
  const originalFetch = globalThis.fetch;
  const originalProvider = process.env.AI_DECISION_PROVIDER;
  process.env.AI_DECISION_PROVIDER = "openai";

  let fetchCalls = 0;
  globalThis.fetch = (async (_url, init) => {
    fetchCalls += 1;

    const requestBody = JSON.parse(String(init?.body));
    assert.equal(requestBody.text.format.name, "agent_market_decision");
    assert.equal(requestBody.text.format.strict, true);

    return {
      ok: true,
      status: 200,
      json: async () => ({
        output_text: JSON.stringify({
          decision_side: "yes",
          confidence: 0.82,
          reason_summary: "OpenAI-backed decision favors YES from the supplied battle context.",
          key_signals: ["strategy=preset momentum", "market context supports yes"],
          risk_factors: ["Outcome can still change before close"],
        }),
      }),
    } as Response;
  }) as typeof fetch;

  try {
    const service = new BattlePredictionService(buildEnv("openai"));
    let mockCalled = false;
    (service as unknown as { generateMockPrediction: () => never }).generateMockPrediction =
      () => {
        mockCalled = true;
        throw new Error("generateMockPrediction should not be called");
      };

    const result = await service.generatePrediction(buildInput());

    assert.equal(fetchCalls, 1);
    assert.equal(mockCalled, false);
    assert.equal(result.provider, "openai");
    assert.equal(result.model, "gpt-test");
    assert.equal(result.prediction.direction, "yes");
    assert.equal(result.prediction.confidence, 0.82);
    assert.equal(
      result.prediction.reasoningSummary,
      "OpenAI-backed decision favors YES from the supplied battle context.",
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalProvider === undefined) {
      delete process.env.AI_DECISION_PROVIDER;
    } else {
      process.env.AI_DECISION_PROVIDER = originalProvider;
    }
  }
});

test("staging battle predictions fail closed unless provider=openai is explicit", async () => {
  const originalAppEnv = process.env.APP_ENV;
  const originalProvider = process.env.AI_DECISION_PROVIDER;
  process.env.APP_ENV = "staging";
  delete process.env.AI_DECISION_PROVIDER;

  try {
    const service = new BattlePredictionService(buildEnv("heuristic"));

    await assert.rejects(
      () => service.generatePrediction(buildInput()),
      /AI_DECISION_PROVIDER must be explicitly set to openai/,
    );

    process.env.AI_DECISION_PROVIDER = "mock";
    const mockService = new BattlePredictionService(buildEnv("mock"));

    await assert.rejects(
      () => mockService.generatePrediction(buildInput()),
      /AI_DECISION_PROVIDER must be explicitly set to openai/,
    );
  } finally {
    if (originalAppEnv === undefined) {
      delete process.env.APP_ENV;
    } else {
      process.env.APP_ENV = originalAppEnv;
    }

    if (originalProvider === undefined) {
      delete process.env.AI_DECISION_PROVIDER;
    } else {
      process.env.AI_DECISION_PROVIDER = originalProvider;
    }
  }
});

test("provider=mock is rejected outside local/development/test runtimes", async () => {
  const originalAppEnv = process.env.APP_ENV;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalProvider = process.env.AI_DECISION_PROVIDER;
  delete process.env.APP_ENV;
  process.env.NODE_ENV = "qa";
  process.env.AI_DECISION_PROVIDER = "mock";

  try {
    const service = new BattlePredictionService(buildEnv("mock"));

    await assert.rejects(
      () => service.generatePrediction(buildInput()),
      /Mock battle predictions are only allowed in local\/development\/test/,
    );
  } finally {
    if (originalAppEnv === undefined) {
      delete process.env.APP_ENV;
    } else {
      process.env.APP_ENV = originalAppEnv;
    }

    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }

    if (originalProvider === undefined) {
      delete process.env.AI_DECISION_PROVIDER;
    } else {
      process.env.AI_DECISION_PROVIDER = originalProvider;
    }
  }
});

test("provider=openai rejects AI responses with unexpected fields", async () => {
  const originalFetch = globalThis.fetch;
  const originalProvider = process.env.AI_DECISION_PROVIDER;
  process.env.AI_DECISION_PROVIDER = "openai";

  globalThis.fetch = (async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({
        output_text: JSON.stringify({
          decision_side: "yes",
          confidence: 0.72,
          reason_summary: "Valid-looking answer with an unexpected field.",
          key_signals: ["signal"],
          risk_factors: ["risk"],
          unexpected_field: "schema drift",
        }),
      }),
    }) as Response) as typeof fetch;

  try {
    const service = new BattlePredictionService(buildEnv("openai"));

    await assert.rejects(
      () => service.generatePrediction(buildInput()),
      /unsupported fields/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalProvider === undefined) {
      delete process.env.AI_DECISION_PROVIDER;
    } else {
      process.env.AI_DECISION_PROVIDER = originalProvider;
    }
  }
});

function buildEnv(provider: "mock" | "heuristic" | "openai") {
  return {
    AI_DECISION_PROVIDER: provider,
    AI_CANONICALIZATION_VERSION: "test-v1",
    OPENAI_API_KEY: "test-key",
    OPENAI_BASE_URL: "https://api.openai.test/v1",
    OPENAI_MODEL: "gpt-test",
    OPENAI_DECISION_MAX_OUTPUT_TOKENS: 200,
  } as unknown as Env;
}

function buildInput(): Parameters<BattlePredictionService["generatePrediction"]>[0] {
  return {
    agent: {
      id: "agent-1",
      name: "Momentum Analyst",
      specialization: "finance",
      description: "A focused market analyst.",
      basePersonality: "Measured and evidence-led.",
      baseStrategy: "Follow momentum when confirmation is strong.",
      riskProfile: "balanced",
      dataFocus: ["news", "technical"],
    },
    market: {
      id: "market-1",
      slug: "test-market",
      title: "Will the test market resolve YES?",
      shortDescription: "A deterministic market used by tests.",
      description: "Test market description.",
      resolutionRule: "Resolve YES when the test condition is met.",
      scoringMethod: "Binary YES/NO settlement.",
      startTime: "2026-05-01T00:00:00.000Z",
      endTime: "2026-05-02T00:00:00.000Z",
    },
    strategy: {
      preset: "momentum",
      technicalWeight: 40,
      newsWeight: 15,
      sentimentWeight: 20,
      macroWeight: 5,
      onchainWeight: 20,
      optionalInsight: null,
    },
  };
}
