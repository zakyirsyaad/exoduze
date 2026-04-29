export type Category = {
  id: string
  slug: string
  name: string
  description: string | null
  market_count: number
  active_market_count: number
}

export type CategoriesResponse = {
  data: Category[]
}

export type NewsSource = {
  slug: string
  name: string
}

export type NewsCategory = {
  slug: string
  name: string
} | null

export type NewsTopic = {
  slug: string
  name: string
}

export type NewsItem = {
  id: string
  title: string
  summary: string | null
  url: string
  image_uri: string | null
  published_at: string // bisa di-parse ke Date nanti
  is_breaking: boolean

  source: NewsSource
  category: NewsCategory
  topics: NewsTopic[]
}

export type NewsResponse = {
  data: {
    items: NewsItem[]
  }
}

export type TopicCategory = {
  slug: string
  name: string
}

export type TrendingTopic = {
  id: string
  slug: string
  name: string
  mentions_count: number
  previous_mentions_count: number
  mentions_delta: number
  mentions_delta_pct: number | null
  unique_sources_count: number
  breaking_news_count: number
  trend_direction: "up" | "down" | "flat" | "new"
  heat_score: number
  rank: number
}

export type TrendingTopicsResponse = {
  data: {
    window: string
    category: TopicCategory | null
    topics: TrendingTopic[]
  }
}

export type AgentCategory = {
  slug: string
  name: string
  is_primary: boolean
}

export type AgentOwner = {
  wallet_address: string
}

export type AgentActivity = {
  active_markets_count: number
}

export type Agent = {
  id: string
  slug: string
  name: string
  description: string
  status: "active" | "inactive"
  avatar_uri: string

  owner: AgentOwner
  categories: AgentCategory[]
  activity: AgentActivity
}

export type AgentStats = {
  resolved_markets: number
  wins: number
  losses: number

  accuracy_pct: string
  bayesian_accuracy: string

  current_streak: number
  best_streak: number

  total_staked_usdc: string
  follower_pnl_usdc: string
}

export type AgentWindow = {
  type: string
  start: string
  end: string
}

export type LeaderboardItem = {
  rank: number
  agent: Agent
  stats: AgentStats
  window: AgentWindow
}

export type PageInfo = {
  limit: number
  returned_count: number
  total_count: number
  has_more: boolean
}

export type LeaderboardResponse = {
  data: {
    window: string
    generated_at: string

    window_range: {
      start: string
      end: string
    }

    summary: {
      total_ranked_agents: number
    }

    podium: LeaderboardItem[]
    agents: LeaderboardItem[]

    page_info: PageInfo
  }
}

export type MarketCategory = {
  id: string
  slug: string
  name: string
}

export type MarketTopic = {
  id: string
  slug: string
  name: string
}

export type MarketTiming = {
  opens_at: string
  join_deadline_at: string
  decision_cutoff_at: string | null
  closes_at: string
}

export type MarketLiquidity = {
  settlement_asset: string
  total_liquidity_usdc: string
}

export type MarketStatus =
  | "draft"
  | "upcoming"
  | "open"
  | "locked"
  | "closed"
  | "resolving"
  | "disputed"
  | "resolved"
  | "cancelled"

export type MarketDecisionSide = "YES" | "NO" | "ABSTAIN"

export type MarketItem = {
  id: string
  slug: string
  title: string
  short_description: string
  image_uri: string | null
  status: MarketStatus
  category: MarketCategory
  topics: MarketTopic[]
  timing: MarketTiming
  liquidity: MarketLiquidity
}

export type MarketsResponse = {
  data: MarketItem[]
}

export type CategoryPageTopic = MarketTopic & {
  market_count: number
  active_market_count: number
}

export type CategoryPageMarket = Omit<MarketItem, "timing"> & {
  timing: MarketTiming & {
    resolves_at: string | null
  }
  agents_summary: {
    total_agents: number
  }
  featured_agents: {
    id: string
    name: string
    avatar_uri: string | null
  }[]
  decision_snapshot: {
    last_updated_at: string | null
  }
}

export type CategoryPageResponse = {
  data: {
    category: Category
    filters: {
      selected_topic: {
        slug: string
        name: string
      } | null
      selected_status: MarketStatus | null
      selected_sort: "ending_soon" | "most_liquid" | "newest"
    }
    topics: CategoryPageTopic[]
    markets: CategoryPageMarket[]
    page_info: {
      next_cursor: string | null
      has_next_page: boolean
      limit: number
    }
  }
}

export type MarketDetailTiming = MarketTiming & {
  resolves_at: string | null
}

export type MarketResolution = {
  oracle_source: string
  oracle_status: string
  final_outcome: string | null
  resolved_at: string | null
  evidence_uri: string | null
  proposed_outcome?: "YES" | "NO" | null
  proposed_by?: string | null
  proposed_at?: string | null
  dispute_deadline?: string | null
  evidence_summary?: string | null
  proposal_status?: "proposed" | "disputed" | "finalized" | "rejected" | null
  resolution_id?: string | null
  evidence_snapshot?: {
    id: string
    category: string | null
    generated_at: string | null
    window_hours: number | null
  } | null
  dispute?: {
    id: string
    status: string | null
    reason: string | null
    created_at: string | null
  } | null
}

export type MarketTransparency = {
  created_by_wallet: string | null
  resolver_wallet: string | null
  rules: unknown[]
  context: Record<string, unknown>
}

export type MarketSettlement = {
  asset: string
  total_liquidity_usdc: string
  final_liquidity_usdc: string | null
}

export type MarketOnchain = {
  market_pubkey: string | null
  program_id: string | null
}

export type MarketDetail = Omit<MarketItem, "timing" | "liquidity"> & {
  description: string
  timing: MarketDetailTiming
  resolution: MarketResolution
  transparency: MarketTransparency
  settlement: MarketSettlement
  onchain: MarketOnchain
  fairness: MarketFairness
}

export type MarketFairness = {
  roster_locked: boolean
  join_deadline_at: string
  live_agent_decisions_visible: boolean
  live_agent_decisions_visible_at: string
}

export type MarketDetailAgentCategory = {
  slug: string
  name: string
  is_primary: boolean
}

export type MarketDetailAgentInfo = {
  id: string
  slug: string
  name: string
  description: string
  avatar_uri: string | null
  categories: MarketDetailAgentCategory[]
}

export type MarketAgentLockedVersion = {
  id: string
  version_no: number
  version_label: string
  model_provider: string
  model_name: string
  joined_at: string
}

export type MarketAgentCommitment = {
  snapshot_hash: string | null
  hash_algo: string | null
  snapshot_uri: string | null
  prompt_hash: string | null
  config_hash: string | null
  verification_status: string | null
  commit_tx_sig: string | null
  onchain_commitment_ref?: string | null
}

export type MarketAgentDecision = {
  side: MarketDecisionSide
  confidence: number
  decided_at: string
  reason_summary: string
  key_signals: string[]
  risk_factors: string[]
}

export type MarketAgentFinalDecision = {
  side: MarketDecisionSide
  confidence?: number | null
  decided_at: string | null
  reason_summary?: string | null
}

export type MarketAgentStats = {
  resolved_markets: number
  accuracy_pct: string
  current_streak: number
  follower_staked_usdc: string
}

export type MarketAgentMarketStats = {
  follower_count: number
  follower_staked_usdc: string
  support_share_pct: number
}

export type MarketAgent = {
  market_agent_id: string
  agent: MarketDetailAgentInfo
  locked_version: MarketAgentLockedVersion
  commitment: MarketAgentCommitment
  current_decision: MarketAgentDecision | null
  final_decision: MarketAgentFinalDecision | null
  stats: MarketAgentStats | null
  market_stats: MarketAgentMarketStats
}

export type MarketMonitoringSummary = {
  total_agents: number
  yes_agents: number
  no_agents: number
  yes_staked_usdc: string
  no_staked_usdc: string
  total_staked_usdc: string
  last_updated_at: string
}

export type MarketMonitoringCurvePoint = {
  recorded_at: string
  yes_agents_count: number
  no_agents_count: number
  yes_staked_usdc: string
  no_staked_usdc: string
  total_agents_count: number
  total_staked_usdc: string
}

export type MarketDecisionTrailAgent = {
  id: string
  name: string
}

export type MarketDecisionTrailItem = {
  id: string
  market_agent_id: string
  agent: MarketDecisionTrailAgent
  sequence_no: number
  decision_side: MarketDecisionSide
  confidence: number
  reason_summary: string
  key_signals: string[]
  risk_factors: string[]
  decided_at: string
}

export type MarketMonitoring = {
  summary: MarketMonitoringSummary | null
  curve: MarketMonitoringCurvePoint[]
}

export type MarketUserPosition = {
  position_id: string
  market_agent_id: string
  agent_id: string
  stake_usdc: string
  status: string
  opened_at: string
  position_units?: string | null
  onchain_position_ref?: string | null
  open_tx_sig?: string | null
}

export type MarketUserPayout = {
  payout_id: string
  market_agent_id: string
  net_usdc: string
  status: string
  paid_at: string | null
  gross_usdc?: string | null
  fee_usdc?: string | null
  payout_tx_sig?: string | null
}

export type MarketUserContext = {
  wallet_address: string
  positions: MarketUserPosition[]
  payouts: MarketUserPayout[]
}

export type MarketDetailResponse = {
  data: {
    market: MarketDetail
    agents: MarketAgent[]
    monitoring: MarketMonitoring
    ai_decision_trail: MarketDecisionTrailItem[]
    user_context: MarketUserContext | null
  }
}

export type MarketNewsResponse = {
  data: NewsItem[]
}

export type HealthResponse = {
  ok: boolean
  service: string
  timestamp: string
}

export type PortfolioBalance = {
  ui_amount_string: string
}

export type PortfolioTokenBalance = PortfolioBalance & {
  amount_base_units: string
  decimals: number
  mint: string | null
}

export type PortfolioUserParticipant = {
  participant_type: "user_participant"
  position: {
    id: string
    stake_usdc: string
    position_units: string | null
    onchain_position_ref: string | null
    open_tx_sig: string | null
    status: string
    opened_at: string
  }
  market: {
    id: string
    slug: string
    title: string
    status: MarketStatus
    onchain_market_pubkey: string | null
  }
  agent: {
    id: string
    slug: string
    name: string
    market_agent_id: string
    final_decision_side: string | null
  }
  payout: {
    id: string
    status: string | null
    net_usdc: string | null
  } | null
}

export type PortfolioAiBattle = {
  participant_type: "ai_join_battle"
  market_agent_id: string
  joined_at: string
  status: string
  final_decision_side: string | null
  final_decision_at: string | null
  follower_staked_usdc: string
  follower_count: number
  agent: {
    id: string
    slug: string
    name: string
  }
  market: {
    id: string
    slug: string
    title: string
    status: MarketStatus
  }
}

export type PortfolioPayout = {
  id: string
  gross_usdc: string
  fee_usdc: string
  net_usdc: string
  payout_tx_sig: string | null
  status: string
  paid_at: string | null
  onchain_position_ref: string | null
  market: {
    id: string
    slug: string
    title: string
    onchain_market_pubkey: string | null
  }
  agent: {
    id: string
    slug: string
    name: string
    market_agent_id: string
  }
}

export type PortfolioResponse = {
  data: {
    wallet: {
      wallet_identity_id: string
      wallet_address: string
    }
    balances: {
      sol: PortfolioBalance & {
        lamports: string
      }
      usdc: PortfolioTokenBalance
    }
    user_participants: PortfolioUserParticipant[]
    ai_battles: PortfolioAiBattle[]
    payouts: PortfolioPayout[]
  }
}

export type OwnerSummary = {
  wallet_identity_id: string
  wallet_address: string
  is_active: boolean
  created_at: string
  categories: AgentCategory[]
  agent_count: number
  active_agents_count: number
  best_rank: number | null
  stats: {
    agent_count: number
    active_agents_count: number
    ranked_agents_count: number
    best_rank: number | null
    resolved_markets: number
    total_staked_usdc: string
    follower_pnl_usdc: string
  }
  top_agent: {
    id: string
    slug: string
    name: string
    avatar_uri: string | null
    rank: number | null
  } | null
}

export type OwnersResponse = {
  data: {
    summary: {
      total_owners: number
      active_owners: number
      total_agents: number
      total_active_agents: number
    }
    owners: OwnerSummary[]
  }
}

export type OwnerProfileResponse = {
  data: {
    owner: OwnerSummary
  }
}

export type AdminMarketDispute = {
  id: string
  market: {
    id: string
    slug: string
    title: string
  }
  resolution: {
    id: string
    proposed_outcome: "YES" | "NO"
    evidence_summary: string
    evidence_snapshot_id: string
    evidence_snapshot_generated_at: string | null
    dispute_deadline: string
  }
  disputed_by: string
  reason: string
  status: string
  created_at: string
}

export type AdminMarketDisputesResponse = {
  data: AdminMarketDispute[]
}
