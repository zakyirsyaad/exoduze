import type {
  AgentCategory,
  CategoriesResponse,
  CategoryPageResponse,
  MarketStatus,
  OwnerSummary,
  PageInfo,
} from "@/hooks/Type"

export type CatalogCategoryListItem = {
  id: string
  slug: string
  name: string
  description: string | null
  market_count: number
  active_market_count: number
  sort_order: number | null
  is_active: boolean
}

export type CatalogTopicListItem = {
  id: string
  slug: string
  name: string
  description: string | null
  is_active: boolean
  category: {
    id: string | null
    slug: string
    name: string
  }
  market_count: number
  active_market_count: number
}

export type CatalogIndex = {
  categories: CatalogCategoryListItem[]
  topics: CatalogTopicListItem[]
}

export type CategoryMutationInput = {
  slug?: string
  name: string
  description?: string | null
  sort_order: number
  is_active: boolean
}

export type TopicMutationInput = {
  category: string
  slug?: string
  name: string
  description?: string | null
  is_active: boolean
}

export type CategoryMutationResponse = {
  data: {
    category: CatalogCategoryListItem
  }
}

export type TopicMutationResponse = {
  data: {
    topic: CatalogTopicListItem
  }
}

export type ManagedAgent = {
  id: string
  slug: string
  name: string
  description: string
  status: "active" | "inactive"
  avatar_uri: string | null
  owner: {
    wallet_address: string
  } | null
  categories: AgentCategory[]
  activity: {
    active_markets_count: number
  }
}

export type AgentListSummary = {
  total_agents: number
  active_agents: number
  ranked_agents: number
  owner_count: number
}

export type AgentListFilters = {
  owner_wallet: string | null
  category: string | null
  status: string | null
  sort: "top_rank" | "newest" | "name"
}

export type AgentsListResponse = {
  data: {
    summary: AgentListSummary
    filters: AgentListFilters
    page_info: PageInfo
    agents: ManagedAgent[]
  }
}

export type OwnerAgentsResponse = {
  data: {
    owner: OwnerSummary
    summary: AgentListSummary
    filters: AgentListFilters
    page_info: PageInfo
    agents: ManagedAgent[]
  }
}

export type AgentMutationInput = {
  owner_wallet?: string
  slug?: string
  name: string
  description: string
  status: "active" | "inactive"
  avatar_uri?: string | null
  category_slugs: string[]
}

export type AgentMutationResponse = {
  data: ManagedAgent
}

export type UploadAgentAvatarResponse = {
  data: {
    avatar_uri: string
  }
}

export type MarketMutationInput = {
  category: string
  slug?: string
  title: string
  short_description: string
  description: string
  image_uri?: string | null
  status: MarketStatus
  oracle_source: string
  settlement_asset: string
  onchain_market_pubkey?: string | null
  opens_at: string
  join_deadline_at?: string
  decision_cutoff_at: string
  closes_at: string
  resolves_at?: string | null
  total_liquidity_usdc: string
  final_liquidity_usdc?: string | null
  resolver_wallet?: string | null
  rules?: string[]
  context?: Record<string, unknown>
  topic_slugs: string[]
}

export type MarketResolveInput = {
  outcome: "YES" | "NO"
  evidence_uri?: string | null
  submitted_tx_sig?: string | null
  resolved_at?: string
}

export type DisputeStatus = "open" | "accepted" | "rejected"

export type CronRunResult = {
  success: boolean
  counts: {
    snapshotsCreated: number
    marketsCreated: number
    marketsChecked: number
    resolutionsProposed: number
    resolutionsFinalized: number
  }
  snapshotsCreated: number
  marketsCreated: number
  marketsChecked: number
  resolutionsProposed: number
  resolutionsFinalized: number
  skipped: number
  errors: Array<Record<string, unknown>>
  reason?: string
  snapshot?: unknown
  markets?: unknown
}

export type CronJobId =
  | "generate-topic-snapshot"
  | "generate-markets"
  | "resolve-markets"
  | "finalize-resolutions"

export type CatalogBootstrap = {
  categoriesResponse: CategoriesResponse
  categoryPages: CategoryPageResponse[]
}
