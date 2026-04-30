import type { Env } from "../../config/env.js";

export type TopicNewsContextItem = {
  id: string;
  title: string;
  summary: string | null;
  url: string;
  sourceName: string;
  publishedAt: string;
  isBreaking: boolean;
  relevanceScore: number;
};

export type MarketCopyInput = {
  topicName: string;
  categoryName: string;
  requiredRank: number;
  cutoffAt: string;
  news: TopicNewsContextItem[];
};

export type MarketCopy = {
  title: string;
  shortDescription: string;
  description: string;
  resolutionCriteria: string[];
  newsHook: string | null;
};

export type MarketCopyGeneration = {
  provider: "openai" | "fallback";
  model: string;
  usedFallback: boolean;
  copy: MarketCopy;
};

const marketCopyJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "title",
    "short_description",
    "description",
    "resolution_criteria",
    "news_hook",
  ],
  properties: {
    title: {
      type: "string",
      minLength: 12,
      maxLength: 140,
    },
    short_description: {
      type: "string",
      minLength: 24,
      maxLength: 280,
    },
    description: {
      type: "string",
      minLength: 120,
      maxLength: 1400,
    },
    resolution_criteria: {
      type: "array",
      minItems: 3,
      maxItems: 5,
      items: {
        type: "string",
        minLength: 12,
        maxLength: 240,
      },
    },
    news_hook: {
      anyOf: [
        {
          type: "string",
          minLength: 8,
          maxLength: 180,
        },
        {
          type: "null",
        },
      ],
    },
  },
} as const;

export class MarketDetailGenerator {
  constructor(private readonly env: Env) {}

  async generate(input: MarketCopyInput): Promise<MarketCopyGeneration> {
    const fallback = buildFallbackMarketCopy(input);

    if (
      this.env.AI_DECISION_PROVIDER !== "openai" ||
      !this.env.OPENAI_API_KEY
    ) {
      return {
        provider: "fallback",
        model: "market-copy-fallback-v1",
        usedFallback: true,
        copy: fallback,
      };
    }

    try {
      const response = await fetch(`${this.env.OPENAI_BASE_URL}/responses`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: this.env.OPENAI_MODEL,
          max_output_tokens: Math.max(
            700,
            this.env.OPENAI_DECISION_MAX_OUTPUT_TOKENS,
          ),
          input: [
            {
              role: "system",
              content: buildSystemPrompt(),
            },
            {
              role: "user",
              content: buildUserPrompt(input),
            },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "market_copy",
              strict: true,
              schema: marketCopyJsonSchema,
            },
          },
        }),
      });

      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          `OpenAI market-copy request failed with HTTP ${response.status}.`,
        );
      }

      const outputText = extractOutputText(body);
      if (!outputText) {
        throw new Error("OpenAI returned an empty market-copy response.");
      }

      return {
        provider: "openai",
        model: this.env.OPENAI_MODEL,
        usedFallback: false,
        copy: validateMarketCopyResponse(JSON.parse(outputText), input),
      };
    } catch {
      return {
        provider: "fallback",
        model: "market-copy-fallback-v1",
        usedFallback: true,
        copy: fallback,
      };
    }
  }
}

export function buildFallbackMarketCopy(input: MarketCopyInput): MarketCopy {
  const cutoffLabel = formatUtcTitleTime(input.cutoffAt);
  const leadNews = input.news[0] ?? null;
  const newsHook = leadNews
    ? truncateSentence(cleanNewsHeadline(leadNews.title), 140)
    : null;
  const title = buildFallbackMarketTitle({
    topicName: input.topicName,
    cutoffAt: input.cutoffAt,
    newsHook,
  });
  const shortDescription = buildFallbackShortDescription({
    topicName: input.topicName,
    categoryName: input.categoryName,
    cutoffLabel,
    newsHook,
  });
  const description = buildFallbackDescription({
    topicName: input.topicName,
    categoryName: input.categoryName,
    requiredRank: input.requiredRank,
    cutoffLabel,
    newsHook,
    leadSummary: leadNews?.summary ?? null,
  });
  const resolutionCriteria = buildResolutionCriteria({
    topicName: input.topicName,
    categoryName: input.categoryName,
    requiredRank: input.requiredRank,
    cutoffLabel,
  });

  return {
    title,
    shortDescription,
    description,
    resolutionCriteria,
    newsHook,
  };
}

export function buildFallbackMarketTitle(input: {
  topicName: string;
  cutoffAt: string;
  newsHook?: string | null | undefined;
}) {
  const cutoffLabel = formatUtcTitleTime(input.cutoffAt);
  const hook = input.newsHook?.trim();
  if (hook) {
    return truncateSentence(
      `Will ${input.topicName} stay in focus through ${cutoffLabel} as ${lowercaseLeading(hook)}?`,
      140,
    );
  }

  return `Will ${input.topicName} keep its headline momentum through ${cutoffLabel}?`;
}

function buildFallbackShortDescription(input: {
  topicName: string;
  categoryName: string;
  cutoffLabel: string;
  newsHook?: string | null | undefined;
}) {
  const hook = input.newsHook?.trim();
  const context = hook
    ? `with fresh headlines led by ${hook}`
    : `as ${input.categoryName} headlines keep moving`;

  return truncateSentence(
    `AI agents are predicting whether ${input.topicName} can hold market attention through ${input.cutoffLabel}, ${context}.`,
    280,
  );
}

function buildFallbackDescription(input: {
  topicName: string;
  categoryName: string;
  requiredRank: number;
  cutoffLabel: string;
  newsHook?: string | null | undefined;
  leadSummary?: string | null | undefined;
}) {
  const hook = input.newsHook?.trim();
  const summary = normalizeSummary(input.leadSummary);
  const contextSentence = hook
    ? `The current news angle centers on ${lowercaseLeading(hook)}${summary ? `, with recent coverage highlighting ${summary}` : ""}.`
    : `The market tracks whether ${input.topicName} keeps attracting enough attention to stay among Exoduze's hottest ${input.categoryName} topics.`;

  return [
    `This AI market is about whether ${input.topicName} can keep its momentum through ${input.cutoffLabel}.`,
    contextSentence,
    `Resolve YES if ${input.topicName} appears within the top ${input.requiredRank} of the first valid Exoduze 24-hour ${input.categoryName} topic snapshot generated after ${input.cutoffLabel}.`,
    `Resolve NO if ${input.topicName} ranks below #${input.requiredRank} or does not appear in that snapshot.`,
  ].join(" ");
}

function buildResolutionCriteria(input: {
  topicName: string;
  categoryName: string;
  requiredRank: number;
  cutoffLabel: string;
}) {
  return [
    `Use the first valid Exoduze 24-hour ${input.categoryName} topic snapshot generated after ${input.cutoffLabel}.`,
    `Resolve YES only if ${input.topicName} appears at rank #${input.requiredRank} or better in that snapshot.`,
    `Resolve NO if ${input.topicName} is ranked below #${input.requiredRank} or does not appear at all.`,
    `News headlines provide context for why the topic is hot, but they do not override the snapshot ranking result.`,
  ];
}

function buildSystemPrompt() {
  return [
    "You write Exoduze AI market copy for autonomous prediction markets.",
    "These markets do NOT resolve on whether a real-world event happens.",
    "They ALWAYS resolve on whether a named topic remains within a required hot-topic rank in the first valid Exoduze 24-hour snapshot generated after the cutoff.",
    "Use the supplied news only as the narrative hook that explains why the topic is currently hot.",
    "Keep the copy precise, audit-friendly, and natural.",
  ].join("\n");
}

function buildUserPrompt(input: MarketCopyInput) {
  return [
    "Write structured JSON market copy for this autonomous topic-persistence market.",
    "",
    "Hard rules:",
    "- The title must be a yes/no question and should feel like a real news-led market name.",
    `- Avoid generic template phrasing such as "top ${input.requiredRank}" in the title unless absolutely necessary.`,
    "- Never use placeholder phrasing such as 'after the cutoff', 'required rank', or 'hot-topic rank' in the title.",
    "- The title should focus on the actual news hook, not on internal resolution mechanics.",
    "- Do not turn this into a market about the underlying event happening.",
    "- The short description must be exactly one sentence.",
    "- The long description must clearly explain the YES and NO resolution criteria.",
    "- Do not mention URLs, database fields, or internal implementation details.",
    "- Never invent facts outside the provided news context.",
    "",
    `Context JSON:\n${JSON.stringify(
      {
        topic_name: input.topicName,
        category_name: input.categoryName,
        required_rank: input.requiredRank,
        cutoff_at: input.cutoffAt,
        resolution_rule:
          "YES only if the topic appears within the required rank in the first valid Exoduze 24-hour snapshot generated after cutoff; otherwise NO.",
        news: input.news.map((item) => ({
          title: item.title,
          summary: item.summary,
          source_name: item.sourceName,
          published_at: item.publishedAt,
          is_breaking: item.isBreaking,
        })),
      },
      null,
      2,
    )}`,
  ].join("\n");
}

function validateMarketCopyResponse(value: unknown, input: MarketCopyInput) {
  if (!value || typeof value !== "object") {
    throw new Error("AI market copy response must be an object.");
  }

  const payload = value as Record<string, unknown>;
  const title = normalizeString(payload.title, "title", 140);
  const shortDescription = normalizeString(
    payload.short_description,
    "short_description",
    280,
  );
  const description = normalizeString(payload.description, "description", 1400);
  const newsHook =
    payload.news_hook === null
      ? null
      : normalizeString(payload.news_hook, "news_hook", 180);
  const resolutionCriteria = normalizeStringList(
    payload.resolution_criteria,
    "resolution_criteria",
    5,
  );

  if (!title.endsWith("?")) {
    throw new Error("AI market title must end with a question mark.");
  }

  const forbiddenTitlePhrases = [
    "after the cutoff",
    "required rank",
    "hot-topic rank",
    "hot topic rank",
    "remain in the required rank",
  ];
  const normalizedTitle = title.toLowerCase();
  if (
    forbiddenTitlePhrases.some((phrase) => normalizedTitle.includes(phrase))
  ) {
    throw new Error("AI market title used a forbidden placeholder phrase.");
  }
  if (normalizedTitle.includes(`top ${input.requiredRank}`)) {
    throw new Error(
      "AI market title fell back to the generic top-rank template.",
    );
  }

  const normalizedTopic = input.topicName.trim().toLowerCase();
  const titleHasTopic = normalizedTitle.includes(normalizedTopic);
  const descriptionHasTopic = description
    .toLowerCase()
    .includes(normalizedTopic);
  if (!titleHasTopic || !descriptionHasTopic) {
    throw new Error("AI market copy must reference the requested topic.");
  }

  const descriptionLower = description.toLowerCase();
  if (
    !descriptionLower.includes("resolve yes") ||
    !descriptionLower.includes("resolve no")
  ) {
    throw new Error("AI market description must explain both YES and NO.");
  }

  return {
    title,
    shortDescription,
    description,
    resolutionCriteria,
    newsHook,
  };
}

function normalizeString(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string.`);
  }

  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) {
    throw new Error(`${field} must not be empty.`);
  }

  if (normalized.length > maxLength) {
    throw new Error(`${field} is too long.`);
  }

  return normalized;
}

function normalizeStringList(
  value: unknown,
  field: string,
  maxItems: number,
): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxItems) {
    throw new Error(`${field} must be a non-empty array.`);
  }

  return value.map((item, index) => {
    const normalized = normalizeString(item, `${field}[${index}]`, 240);
    return normalized.endsWith(".")
      ? normalized.slice(0, normalized.length - 1)
      : normalized;
  });
}

function cleanNewsHeadline(value: string) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s+[-|]\s+(Reuters|AP|Bloomberg|CNBC|BBC|CNN)$/i, "")
    .replace(/[.!?]+$/, "");
}

function normalizeSummary(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return null;
  }

  return truncateSentence(stripTrailingPunctuation(normalized), 180);
}

function lowercaseLeading(value: string) {
  if (!value) {
    return value;
  }

  return value.charAt(0).toLowerCase() + value.slice(1);
}

function stripTrailingPunctuation(value: string) {
  return value.replace(/[.!?]+$/, "");
}

function truncateSentence(value: string, maxLength: number) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) {
    return normalized;
  }

  const truncated = normalized.slice(0, Math.max(0, maxLength - 1));
  const boundary = truncated.lastIndexOf(" ");
  const safe = boundary > 40 ? truncated.slice(0, boundary) : truncated;
  return `${safe.trim()}...`;
}

function extractOutputText(response: unknown) {
  if (
    response &&
    typeof response === "object" &&
    "output_text" in response &&
    typeof (response as { output_text?: unknown }).output_text === "string"
  ) {
    return (response as { output_text: string }).output_text;
  }

  const output = (response as { output?: unknown[] } | null)?.output;
  if (!Array.isArray(output)) {
    return null;
  }

  for (const item of output) {
    const content = (item as { content?: unknown[] } | null)?.content;
    if (!Array.isArray(content)) {
      continue;
    }

    for (const entry of content) {
      if (
        entry &&
        typeof entry === "object" &&
        (entry as { type?: unknown }).type === "output_text" &&
        typeof (entry as { text?: unknown }).text === "string"
      ) {
        return (entry as { text: string }).text;
      }
    }
  }

  return null;
}

export function formatUtcTitleTime(value: string) {
  const date = new Date(value);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes} UTC`;
}
