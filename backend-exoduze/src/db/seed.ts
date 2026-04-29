import type { Pool, PoolClient } from "pg";

import { env } from "../config/env.js";
import { explainDatabaseConnectionError } from "./connection-error.js";
import { createDatabase, closeDatabase } from "./database.js";
import { createStableId, hashText } from "../lib/ids.js";

type AppDatabase = Pool;

type InsertRow = Record<string, string | number | boolean | null | undefined>;

function normalizeRowValue(column: string, value: InsertRow[string]) {
  if (value === undefined || value === null) {
    return null;
  }

  if ((column.startsWith("is_") || column === "was_correct") && typeof value === "number") {
    return value === 1;
  }

  return value;
}

async function insertMany(client: PoolClient, tableName: string, rows: InsertRow[]): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  const firstRow = rows[0];
  if (!firstRow) {
    return;
  }

  const columns = Object.keys(firstRow);
  const quotedColumns = columns.map((column) => `"${column}"`).join(", ");

  for (const row of rows) {
    const values = columns.map((column) => normalizeRowValue(column, row[column]));
    const placeholders = values.map((_, index) => `$${index + 1}`).join(", ");
    await client.query(
      `INSERT INTO ${tableName} (${quotedColumns}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
      values
    );
  }
}

export async function seedDatabase(db: AppDatabase): Promise<void> {
  const countResult = await db.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM categories");
  const count = Number(countResult.rows[0]?.count ?? 0);

  if (count > 0) {
    return;
  }

  const categories = [
    {
      id: "cat_politics",
      slug: "politics",
      name: "Politics",
      description: "Elections, policy, regulation, and geopolitical events.",
      sort_order: 1,
      is_active: 1
    },
    {
      id: "cat_esports",
      slug: "esports",
      name: "Esports",
      description: "Competitive gaming, tournaments, and team performance.",
      sort_order: 2,
      is_active: 1
    },
    {
      id: "cat_finance",
      slug: "finance",
      name: "Finance",
      description: "Markets, companies, rates, and financial system events.",
      sort_order: 3,
      is_active: 1
    },
    {
      id: "cat_tech",
      slug: "tech",
      name: "Tech",
      description: "AI, chips, software launches, and product milestones.",
      sort_order: 4,
      is_active: 1
    },
    {
      id: "cat_crypto",
      slug: "crypto",
      name: "Crypto",
      description: "Digital asset, protocol, ETF, and ecosystem events.",
      sort_order: 5,
      is_active: 1
    },
    {
      id: "cat_sports",
      slug: "sports",
      name: "Sports",
      description: "Traditional sports markets and events.",
      sort_order: 6,
      is_active: 1
    },
    {
      id: "cat_economy",
      slug: "economy",
      name: "Economy",
      description: "Macro data, inflation, rates, and labor market events.",
      sort_order: 7,
      is_active: 1
    },
    {
      id: "cat_science",
      slug: "science",
      name: "Science",
      description: "Research, biotech, climate, and space developments.",
      sort_order: 8,
      is_active: 1
    }
  ];

  const topics = [
    ["cat_politics", "election", "Election", "Election races, polling, and outcomes."],
    ["cat_politics", "policy", "Policy", "Bills, executive actions, and policy changes."],
    ["cat_politics", "geopolitics", "Geopolitics", "International relations and diplomatic shifts."],
    ["cat_esports", "valorant", "Valorant", "Valorant tournament and roster storylines."],
    ["cat_esports", "league-of-legends", "League of Legends", "League esports and tournament results."],
    ["cat_esports", "dota", "Dota", "Dota tournaments and ecosystem news."],
    ["cat_finance", "earnings", "Earnings", "Quarterly company earnings and surprises."],
    ["cat_finance", "stocks", "Stocks", "Equities, indexes, and company catalysts."],
    ["cat_finance", "rates", "Rates", "Interest rate expectations and moves."],
    ["cat_finance", "oil", "Oil", "Energy markets, crude prices, and supply news."],
    ["cat_finance", "crypto", "Crypto", "Digital asset market and ETF-linked finance topics."],
    ["cat_tech", "ai", "AI", "Artificial intelligence model and product updates."],
    ["cat_tech", "chips", "Chips", "Semiconductors, fabs, and supply chain topics."],
    ["cat_tech", "product-launch", "Product Launch", "Consumer and developer product releases."],
    ["cat_crypto", "bitcoin", "Bitcoin", "Bitcoin markets, ETF, and network catalysts."],
    ["cat_crypto", "ethereum", "Ethereum", "Ethereum ecosystem and market developments."],
    ["cat_crypto", "solana", "Solana", "Solana ecosystem and market developments."],
    ["cat_crypto", "etf", "ETF", "ETF-related crypto developments."],
    ["cat_crypto", "defi", "DeFi", "Decentralized finance protocols and metrics."],
    ["cat_crypto", "memecoin", "Memecoin", "Meme token and social-driven market activity."],
    ["cat_sports", "football", "Football", "Football league and tournament developments."],
    ["cat_sports", "basketball", "Basketball", "Basketball league and tournament developments."],
    ["cat_sports", "formula-1", "Formula 1", "Formula 1 races and driver/team performance."],
    ["cat_economy", "cpi", "CPI", "Inflation and CPI releases."],
    ["cat_economy", "gdp", "GDP", "Growth and GDP releases."],
    ["cat_economy", "labor", "Labor", "Employment and labor market data."],
    ["cat_science", "space", "Space", "Launches, missions, and space programs."],
    ["cat_science", "biotech", "Biotech", "Clinical trials and biotech milestones."],
    ["cat_science", "climate", "Climate", "Climate science and weather pattern developments."]
  ].map(([categoryId, slug, name, description]) => ({
    id: `topic_${slug}`,
    category_id: categoryId,
    slug,
    name,
    description,
    is_active: 1
  }));

  const wallets = [
    {
      id: "wallet_admin",
      wallet_address: "8AdminWalletPubkey111111111111111111111111111",
      is_active: 1,
      last_login_at: "2026-04-21T02:00:00Z"
    },
    {
      id: "wallet_user_1",
      wallet_address: "9UserWalletPubkey1111111111111111111111111111",
      is_active: 1,
      last_login_at: "2026-04-21T07:12:00Z"
    }
  ];

  const roleBindings = [
    {
      id: "role_admin_1",
      wallet_identity_id: "wallet_admin",
      role: "admin",
      granted_by_wallet_id: "wallet_admin",
      granted_at: "2026-04-19T03:00:00Z"
    },
    {
      id: "role_oracle_1",
      wallet_identity_id: "wallet_admin",
      role: "oracle_operator",
      granted_by_wallet_id: "wallet_admin",
      granted_at: "2026-04-19T03:00:00Z"
    }
  ];

  const agents = [
    {
      id: "agt_alpha",
      slug: "alpha-agent",
      name: "Alpha Agent",
      description: "Macro-aware crypto prediction agent focused on regime shifts and ETF catalysts.",
      owner_wallet_identity_id: "wallet_admin",
      status: "active",
      avatar_uri: "https://images.exoduze.dev/agents/alpha.png"
    },
    {
      id: "agt_beta",
      slug: "beta-agent",
      name: "Beta Agent",
      description: "Event-driven agent that leans on headline velocity and catalyst timing.",
      owner_wallet_identity_id: "wallet_admin",
      status: "active",
      avatar_uri: "https://images.exoduze.dev/agents/beta.png"
    },
    {
      id: "agt_gamma",
      slug: "gamma-agent",
      name: "Gamma Agent",
      description: "Conservative agent with a high-confidence filter and slower stance changes.",
      owner_wallet_identity_id: "wallet_admin",
      status: "active",
      avatar_uri: "https://images.exoduze.dev/agents/gamma.png"
    },
    {
      id: "agt_delta",
      slug: "delta-agent",
      name: "Delta Agent",
      description: "Momentum-following agent tuned for tech and crypto catalyst cycles.",
      owner_wallet_identity_id: "wallet_admin",
      status: "active",
      avatar_uri: "https://images.exoduze.dev/agents/delta.png"
    }
  ];

  const agentCategories = [
    ["agt_alpha", "cat_crypto", 1],
    ["agt_alpha", "cat_finance", 0],
    ["agt_beta", "cat_crypto", 1],
    ["agt_beta", "cat_tech", 0],
    ["agt_gamma", "cat_economy", 1],
    ["agt_gamma", "cat_finance", 0],
    ["agt_delta", "cat_tech", 1],
    ["agt_delta", "cat_crypto", 0]
  ].map(([agentId, categoryId, isPrimary], index) => ({
    id: `agent_cat_${index + 1}`,
    agent_id: agentId,
    category_id: categoryId,
    is_primary: isPrimary
  }));

  const promptArtifacts = [
    {
      id: "prompt_alpha_v12",
      artifact_uri: "https://artifacts.exoduze.dev/alpha/v12/manifest.json",
      artifact_hash: hashText("alpha-v12-prompt-manifest"),
      hash_algo: "sha256",
      canonicalization_version: "v1",
      is_public: 1,
      published_at: "2026-04-20T09:00:00Z"
    },
    {
      id: "prompt_beta_v7",
      artifact_uri: "https://artifacts.exoduze.dev/beta/v7/manifest.json",
      artifact_hash: hashText("beta-v7-prompt-manifest"),
      hash_algo: "sha256",
      canonicalization_version: "v1",
      is_public: 1,
      published_at: "2026-04-20T09:00:00Z"
    },
    {
      id: "prompt_gamma_v5",
      artifact_uri: "https://artifacts.exoduze.dev/gamma/v5/manifest.json",
      artifact_hash: hashText("gamma-v5-prompt-manifest"),
      hash_algo: "sha256",
      canonicalization_version: "v1",
      is_public: 1,
      published_at: "2026-04-20T09:00:00Z"
    },
    {
      id: "prompt_delta_v3",
      artifact_uri: "https://artifacts.exoduze.dev/delta/v3/manifest.json",
      artifact_hash: hashText("delta-v3-prompt-manifest"),
      hash_algo: "sha256",
      canonicalization_version: "v1",
      is_public: 1,
      published_at: "2026-04-20T09:00:00Z"
    }
  ];

  const agentVersions = [
    {
      id: "agv_alpha_12",
      agent_id: "agt_alpha",
      version_no: 12,
      version_label: "v12",
      prompt_artifact_id: "prompt_alpha_v12",
      model_provider: "openai",
      model_name: "gpt-5.2",
      runtime_config_json: JSON.stringify({ temperature: 0.2, risk_mode: "balanced" }),
      config_hash: hashText("alpha-v12-config"),
      version_hash: hashText("alpha-v12-version"),
      status: "published"
    },
    {
      id: "agv_beta_7",
      agent_id: "agt_beta",
      version_no: 7,
      version_label: "v7",
      prompt_artifact_id: "prompt_beta_v7",
      model_provider: "anthropic",
      model_name: "claude-sonnet-4",
      runtime_config_json: JSON.stringify({ temperature: 0.4, risk_mode: "reactive" }),
      config_hash: hashText("beta-v7-config"),
      version_hash: hashText("beta-v7-version"),
      status: "published"
    },
    {
      id: "agv_gamma_5",
      agent_id: "agt_gamma",
      version_no: 5,
      version_label: "v5",
      prompt_artifact_id: "prompt_gamma_v5",
      model_provider: "openai",
      model_name: "gpt-5.1",
      runtime_config_json: JSON.stringify({ temperature: 0.1, risk_mode: "conservative" }),
      config_hash: hashText("gamma-v5-config"),
      version_hash: hashText("gamma-v5-version"),
      status: "published"
    },
    {
      id: "agv_delta_3",
      agent_id: "agt_delta",
      version_no: 3,
      version_label: "v3",
      prompt_artifact_id: "prompt_delta_v3",
      model_provider: "openai",
      model_name: "gpt-5.2",
      runtime_config_json: JSON.stringify({ temperature: 0.6, risk_mode: "momentum" }),
      config_hash: hashText("delta-v3-config"),
      version_hash: hashText("delta-v3-version"),
      status: "published"
    }
  ];

  const markets: InsertRow[] = [];
  const marketTopics: InsertRow[] = [];
  const marketAgents: InsertRow[] = [];
  const commitments: InsertRow[] = [];
  const decisions: InsertRow[] = [];
  const userPositions: InsertRow[] = [];
  const oracleResults: InsertRow[] = [];
  const payouts: InsertRow[] = [];
  const monitoringPoints: InsertRow[] = [];
  const leaderboardFacts: InsertRow[] = [];

  const leaderboardSnapshots = [
    ["lbs_alpha", "all_time", "2026-01-01T00:00:00Z", "2026-04-21T00:00:00Z", "agt_alpha", 1, 37, 26, 11, "70.27", "68.42", 4, 9, "40221.50", "6120.20"],
    ["lbs_beta", "all_time", "2026-01-01T00:00:00Z", "2026-04-21T00:00:00Z", "agt_beta", 2, 19, 11, 8, "57.89", "55.10", 1, 4, "18321.80", "2120.60"],
    ["lbs_gamma", "all_time", "2026-01-01T00:00:00Z", "2026-04-21T00:00:00Z", "agt_gamma", 3, 22, 15, 7, "68.18", "66.11", 3, 6, "17420.00", "2890.10"],
    ["lbs_delta", "all_time", "2026-01-01T00:00:00Z", "2026-04-21T00:00:00Z", "agt_delta", 4, 14, 7, 7, "50.00", "49.25", 2, 5, "11350.00", "920.40"]
  ].map(
    ([
      id,
      windowType,
      windowStart,
      windowEnd,
      agentId,
      rank,
      resolvedMarkets,
      wins,
      losses,
      accuracyPct,
      bayesianAccuracy,
      currentStreak,
      bestStreak,
      totalStakedUsdc,
      followerPnlUsdc
    ]) => ({
      id,
      window_type: windowType,
      window_start: windowStart,
      window_end: windowEnd,
      agent_id: agentId,
      rank,
      resolved_markets: resolvedMarkets,
      wins,
      losses,
      accuracy_pct: accuracyPct,
      bayesian_accuracy: bayesianAccuracy,
      current_streak: currentStreak,
      best_streak: bestStreak,
      total_staked_usdc: totalStakedUsdc,
      follower_pnl_usdc: followerPnlUsdc
    })
  );

  const newsSources = [
    {
      id: "source_newsapi",
      slug: "newsapi",
      name: "NewsAPI",
      source_type: "news-api",
      base_url: "https://newsapi.org/v2",
      is_active: 1,
      reliability_score: 0.82
    },
    {
      id: "source_coingecko",
      slug: "coingecko",
      name: "CoinGecko",
      source_type: "market-data",
      base_url: "https://api.coingecko.com/api/v3",
      is_active: 1,
      reliability_score: 0.8
    }
  ];

  const newsItems = [
    {
      id: createStableId("news", "https://seed.exoduze.dev/news/solana-etf"),
      source_id: "source_newsapi",
      external_id: "seed_solana_etf",
      title: "Solana ETF filing momentum picks up after new issuer commentary",
      summary: "Fresh issuer commentary has pushed Solana ETF discussion back into focus.",
      url: "https://seed.exoduze.dev/news/solana-etf",
      image_uri: null,
      published_at: "2026-04-20T12:00:00Z",
      language: "en",
      category_id: "cat_crypto",
      sentiment_label: "positive",
      sentiment_score: 0.64,
      is_breaking: 1,
      mention_weight: 1.3,
      raw_payload_json: JSON.stringify({ seed: true })
    },
    {
      id: createStableId("news", "https://seed.exoduze.dev/news/fed-inflation"),
      source_id: "source_newsapi",
      external_id: "seed_fed_inflation",
      title: "Inflation surprise keeps rate-cut debate active into the next Fed window",
      summary: "Fresh CPI chatter and rate repricing continue to dominate macro desks.",
      url: "https://seed.exoduze.dev/news/fed-inflation",
      image_uri: null,
      published_at: "2026-04-20T15:30:00Z",
      language: "en",
      category_id: "cat_economy",
      sentiment_label: "neutral",
      sentiment_score: 0.1,
      is_breaking: 0,
      mention_weight: 1.1,
      raw_payload_json: JSON.stringify({ seed: true })
    },
    {
      id: createStableId("news", "https://seed.exoduze.dev/news/ai-policy-bill"),
      source_id: "source_newsapi",
      external_id: "seed_ai_policy",
      title: "Committee movement revives debate over a major US AI policy bill",
      summary: "A fresh committee milestone has reignited policy and election chatter.",
      url: "https://seed.exoduze.dev/news/ai-policy-bill",
      image_uri: null,
      published_at: "2026-04-21T03:20:00Z",
      language: "en",
      category_id: "cat_politics",
      sentiment_label: "positive",
      sentiment_score: 0.42,
      is_breaking: 1,
      mention_weight: 1.25,
      raw_payload_json: JSON.stringify({ seed: true })
    }
  ];

  const newsItemTopics = [
    ["https://seed.exoduze.dev/news/solana-etf", "topic_solana", 1, 1],
    ["https://seed.exoduze.dev/news/solana-etf", "topic_etf", 0.92, 0],
    ["https://seed.exoduze.dev/news/fed-inflation", "topic_cpi", 1, 1],
    ["https://seed.exoduze.dev/news/fed-inflation", "topic_rates", 0.8, 0],
    ["https://seed.exoduze.dev/news/ai-policy-bill", "topic_policy", 1, 1],
    ["https://seed.exoduze.dev/news/ai-policy-bill", "topic_election", 0.55, 0]
  ].map(([url, topicId, relevanceScore, isPrimary], index) => ({
    id: `news_topic_${index + 1}`,
    news_item_id: createStableId("news", String(url)),
    topic_id: topicId,
    relevance_score: relevanceScore,
    is_primary: isPrimary
  }));

  const newsItemMarkets: InsertRow[] = [];

  const mentionTimeseries = [
    ["mts_solana_prev", "topic_solana", "2026-04-19T00:00:00Z", "2026-04-20T00:00:00Z", "day", 10, 8, 3, 1, 12.3],
    ["mts_solana_curr", "topic_solana", "2026-04-20T00:00:00Z", "2026-04-21T00:00:00Z", "day", 12, 10, 4, 1, 15.1],
    ["mts_etf_prev", "topic_etf", "2026-04-19T00:00:00Z", "2026-04-20T00:00:00Z", "day", 9, 10, 3, 1, 10.9],
    ["mts_etf_curr", "topic_etf", "2026-04-20T00:00:00Z", "2026-04-21T00:00:00Z", "day", 11, 9, 4, 1, 13.4],
    ["mts_policy_prev", "topic_policy", "2026-04-19T00:00:00Z", "2026-04-20T00:00:00Z", "day", 12, 9, 4, 1, 14.8],
    ["mts_policy_curr", "topic_policy", "2026-04-20T00:00:00Z", "2026-04-21T00:00:00Z", "day", 15, 12, 5, 1, 18.1],
    ["mts_cpi_prev", "topic_cpi", "2026-04-19T00:00:00Z", "2026-04-20T00:00:00Z", "day", 14, 13, 4, 0, 15.2],
    ["mts_cpi_curr", "topic_cpi", "2026-04-20T00:00:00Z", "2026-04-21T00:00:00Z", "day", 13, 14, 3, 0, 14.0]
  ].map(
    ([
      id,
      topicId,
      bucketStartAt,
      bucketEndAt,
      bucketGranularity,
      mentionsCount,
      previousMentionsCount,
      uniqueSourcesCount,
      breakingNewsCount,
      weightedMentionsScore
    ]) => ({
      id,
      topic_id: topicId,
      bucket_start_at: bucketStartAt,
      bucket_end_at: bucketEndAt,
      bucket_granularity: bucketGranularity,
      mentions_count: mentionsCount,
      previous_mentions_count: previousMentionsCount,
      unique_sources_count: uniqueSourcesCount,
      breaking_news_count: breakingNewsCount,
      weighted_mentions_score: weightedMentionsScore
    })
  );

  const hotTopicSnapshots = [
    ["hot_solana", "cat_crypto", "topic_solana", "24h", "2026-04-20T00:00:00Z", "2026-04-21T00:00:00Z", 12, 10, 2, 20, 4, 1, 33.1, "up", 1],
    ["hot_etf", "cat_crypto", "topic_etf", "24h", "2026-04-20T00:00:00Z", "2026-04-21T00:00:00Z", 11, 9, 2, 22.22, 4, 1, 30.5, "up", 2],
    ["hot_policy", "cat_politics", "topic_policy", "24h", "2026-04-20T00:00:00Z", "2026-04-21T00:00:00Z", 15, 12, 3, 25, 5, 1, 34.2, "up", 1],
    ["hot_cpi", "cat_economy", "topic_cpi", "24h", "2026-04-20T00:00:00Z", "2026-04-21T00:00:00Z", 13, 14, -1, -7.14, 3, 0, 21.0, "down", 1]
  ].map(
    ([
      id,
      categoryId,
      topicId,
      windowType,
      windowStart,
      windowEnd,
      mentionsCount,
      previousMentionsCount,
      mentionsDelta,
      mentionsDeltaPct,
      uniqueSourcesCount,
      breakingNewsCount,
      heatScore,
      trendDirection,
      rank
    ]) => ({
      id,
      category_id: categoryId,
      topic_id: topicId,
      window_type: windowType,
      window_start: windowStart,
      window_end: windowEnd,
      mentions_count: mentionsCount,
      previous_mentions_count: previousMentionsCount,
      mentions_delta: mentionsDelta,
      mentions_delta_pct: mentionsDeltaPct,
      unique_sources_count: uniqueSourcesCount,
      breaking_news_count: breakingNewsCount,
      heat_score: heatScore,
      trend_direction: trendDirection,
      rank
    })
  );

  const chainEvents: InsertRow[] = [];
  const indexerCursors: InsertRow[] = [];

  const auditLogs = [
    {
      id: "audit_seed_publish_agent",
      actor_type: "wallet",
      actor_wallet_identity_id: "wallet_admin",
      action: "agent_version_published",
      entity_type: "agent_version",
      entity_id: "agv_alpha_12",
      before_json: null,
      after_json: JSON.stringify({ status: "published" }),
      request_id: "req_seed_publish_1"
    }
  ];

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await insertMany(client, "wallet_identities", wallets);
    await insertMany(client, "role_bindings", roleBindings);
    await insertMany(client, "categories", categories);
    await insertMany(client, "topics", topics);
    await insertMany(client, "agents", agents);
    await insertMany(client, "agent_categories", agentCategories);
    await insertMany(client, "prompt_artifacts", promptArtifacts);
    await insertMany(client, "agent_versions", agentVersions);
    await insertMany(client, "markets", markets);
    await insertMany(client, "market_topics", marketTopics);
    await insertMany(client, "market_agents", marketAgents);
    await insertMany(client, "agent_commitments", commitments);
    await insertMany(client, "agent_market_decisions", decisions);
    await insertMany(client, "user_positions", userPositions);
    await insertMany(client, "oracle_results", oracleResults);
    await insertMany(client, "payouts", payouts);
    await insertMany(client, "market_monitoring_points", monitoringPoints);
    await insertMany(client, "leaderboard_facts", leaderboardFacts);
    await insertMany(client, "leaderboard_agent_snapshots", leaderboardSnapshots);
    await insertMany(client, "news_sources", newsSources);
    await insertMany(client, "news_items", newsItems);
    await insertMany(client, "news_item_topics", newsItemTopics);
    await insertMany(client, "news_item_markets", newsItemMarkets);
    await insertMany(client, "topic_mention_timeseries", mentionTimeseries);
    await insertMany(client, "hot_topic_snapshots", hotTopicSnapshots);
    await insertMany(client, "chain_events", chainEvents);
    await insertMany(client, "indexer_cursors", indexerCursors);
    await insertMany(client, "audit_logs", auditLogs);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function run() {
  const db = createDatabase(env);
  try {
    await seedDatabase(db);
    console.log("Seed completed.");
  } finally {
    await closeDatabase(db);
  }
}

const executedFile = process.argv[1];
if (executedFile && executedFile.endsWith("seed.ts")) {
  run().catch(async (error) => {
    console.error((await explainDatabaseConnectionError(error, env.DATABASE_URL)) ?? error);
    process.exit(1);
  });
}
