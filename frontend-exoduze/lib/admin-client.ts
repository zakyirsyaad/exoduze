import type {
  AdminMarketDisputesResponse,
  CategoriesResponse,
  CategoryPageResponse,
  HealthResponse,
  MarketDetailResponse,
  MarketsResponse,
  OwnerProfileResponse,
  OwnersResponse,
} from "@/hooks/Type"
import { apiFetch } from "@/lib/api"
import type {
  AgentMutationInput,
  AgentMutationResponse,
  AgentsListResponse,
  CatalogBootstrap,
  CatalogIndex,
  CatalogTopicListItem,
  CategoryMutationInput,
  CategoryMutationResponse,
  CronJobId,
  CronRunResult,
  MarketMutationInput,
  MarketResolveInput,
  OnchainConfigResponse,
  OwnerAgentsResponse,
  TopicMutationInput,
  TopicMutationResponse,
  UpdateTreasuryAuthorityInput,
  UpdateTreasuryAuthorityResponse,
  UploadAgentAvatarResponse,
} from "@/lib/admin-types"

export async function fetchCatalogBootstrap(): Promise<CatalogBootstrap> {
  const categoriesResponse = await apiFetch<CategoriesResponse>("/v1/categories", {
    method: "GET",
    auth: false,
  })

  const categoryPages = (
    await Promise.all(
      categoriesResponse.data.map((category) =>
        apiFetch<CategoryPageResponse>(
          `/v1/categories/${encodeURIComponent(category.slug)}?limit=1`,
          {
            method: "GET",
            auth: false,
          }
        )
      )
    )
  ).filter(Boolean)

  return {
    categoriesResponse,
    categoryPages,
  }
}

export async function fetchCatalogIndex(): Promise<CatalogIndex> {
  const { categoriesResponse, categoryPages } = await fetchCatalogBootstrap()
  const topics: CatalogTopicListItem[] = categoryPages.flatMap((page) =>
    page.data.topics.map((topic) => ({
      id: topic.id,
      slug: topic.slug,
      name: topic.name,
      description: null,
      is_active: true,
      category: {
        id: page.data.category.id,
        slug: page.data.category.slug,
        name: page.data.category.name,
      },
      market_count: topic.market_count,
      active_market_count: topic.active_market_count,
    }))
  )

  return {
    categories: categoriesResponse.data.map((category) => ({
      ...category,
      sort_order: null,
      is_active: true,
    })),
    topics,
  }
}

export function fetchCategoryPage(categorySlug: string) {
  return apiFetch<CategoryPageResponse>(
    `/v1/categories/${encodeURIComponent(categorySlug)}?limit=20`,
    {
      method: "GET",
      auth: false,
    }
  )
}

export function createCategory(input: CategoryMutationInput) {
  return apiFetch<CategoryMutationResponse>("/v1/categories", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export function replaceCategory(categoryIdOrSlug: string, input: CategoryMutationInput) {
  return apiFetch<CategoryMutationResponse>(
    `/v1/categories/${encodeURIComponent(categoryIdOrSlug)}`,
    {
      method: "PUT",
      body: JSON.stringify(input),
    }
  )
}

export function patchCategory(
  categoryIdOrSlug: string,
  input: Partial<CategoryMutationInput>
) {
  return apiFetch<CategoryMutationResponse>(
    `/v1/categories/${encodeURIComponent(categoryIdOrSlug)}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    }
  )
}

export function deleteCategory(categoryIdOrSlug: string) {
  return apiFetch<CategoryMutationResponse>(
    `/v1/categories/${encodeURIComponent(categoryIdOrSlug)}`,
    {
      method: "DELETE",
    }
  )
}

export function createTopic(input: TopicMutationInput) {
  return apiFetch<TopicMutationResponse>("/v1/topics", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export function replaceTopic(topicIdOrSlug: string, input: TopicMutationInput) {
  return apiFetch<TopicMutationResponse>(
    `/v1/topics/${encodeURIComponent(topicIdOrSlug)}`,
    {
      method: "PUT",
      body: JSON.stringify(input),
    }
  )
}

export function patchTopic(topicIdOrSlug: string, input: Partial<TopicMutationInput>) {
  return apiFetch<TopicMutationResponse>(
    `/v1/topics/${encodeURIComponent(topicIdOrSlug)}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    }
  )
}

export function deleteTopic(topicIdOrSlug: string) {
  return apiFetch<TopicMutationResponse>(
    `/v1/topics/${encodeURIComponent(topicIdOrSlug)}`,
    {
      method: "DELETE",
    }
  )
}

export function fetchMarkets(filters?: {
  category?: string
  topic?: string
  status?: string
}) {
  return apiFetch<MarketsResponse>(`/v1/markets${buildQuery(filters)}`, {
    method: "GET",
    auth: false,
  })
}

export function fetchMarketDetail(marketIdOrSlug: string) {
  return apiFetch<MarketDetailResponse>(
    `/v1/markets/${encodeURIComponent(marketIdOrSlug)}`,
    {
      method: "GET",
      auth: false,
    }
  )
}

export function createMarket(input: MarketMutationInput) {
  return apiFetch<MarketDetailResponse>("/v1/markets", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export function replaceMarket(marketIdOrSlug: string, input: MarketMutationInput) {
  return apiFetch<MarketDetailResponse>(
    `/v1/markets/${encodeURIComponent(marketIdOrSlug)}`,
    {
      method: "PUT",
      body: JSON.stringify(input),
    }
  )
}

export function patchMarket(
  marketIdOrSlug: string,
  input: Partial<MarketMutationInput>
) {
  return apiFetch<MarketDetailResponse>(
    `/v1/markets/${encodeURIComponent(marketIdOrSlug)}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    }
  )
}

export function deleteMarket(marketIdOrSlug: string) {
  return apiFetch<MarketDetailResponse>(
    `/v1/markets/${encodeURIComponent(marketIdOrSlug)}`,
    {
      method: "DELETE",
    }
  )
}

export function publishMarketOnchain(marketIdOrSlug: string) {
  return apiFetch<MarketDetailResponse>(
    `/v1/markets/${encodeURIComponent(marketIdOrSlug)}/onchain`,
    {
      method: "POST",
    }
  )
}

export function resolveMarket(marketIdOrSlug: string, input: MarketResolveInput) {
  return apiFetch<MarketDetailResponse>(
    `/v1/markets/${encodeURIComponent(marketIdOrSlug)}/resolve`,
    {
      method: "POST",
      body: JSON.stringify(input),
    }
  )
}

export function fetchAgentsList(filters?: {
  owner_wallet?: string
  category?: string
  status?: string
  sort?: "top_rank" | "newest" | "name"
  limit?: number
}) {
  return apiFetch<AgentsListResponse>(`/v1/agents${buildQuery(filters)}`, {
    method: "GET",
    auth: false,
  })
}

export function updateAgent(agentIdOrSlug: string, input: AgentMutationInput) {
  return apiFetch<AgentMutationResponse>(
    `/v1/agents/${encodeURIComponent(agentIdOrSlug)}`,
    {
      method: "PUT",
      body: JSON.stringify(input),
    }
  )
}

export function patchAgent(agentIdOrSlug: string, input: Partial<AgentMutationInput>) {
  return apiFetch<AgentMutationResponse>(
    `/v1/agents/${encodeURIComponent(agentIdOrSlug)}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    }
  )
}

export function deleteAgent(agentIdOrSlug: string) {
  return apiFetch<AgentMutationResponse>(
    `/v1/agents/${encodeURIComponent(agentIdOrSlug)}`,
    {
      method: "DELETE",
    }
  )
}

export function uploadAgentAvatar(file: File) {
  const body = new FormData()
  body.append("file", file)

  return apiFetch<UploadAgentAvatarResponse>("/v1/uploads/agent-avatar", {
    method: "POST",
    body,
  })
}

export function fetchOwners() {
  return apiFetch<OwnersResponse>("/v1/owners", {
    method: "GET",
    auth: false,
  })
}

export function fetchOwnerProfile(walletAddress: string) {
  return apiFetch<OwnerProfileResponse>(
    `/v1/owners/${encodeURIComponent(walletAddress)}`,
    {
      method: "GET",
      auth: false,
    }
  )
}

export function fetchOwnerAgents(walletAddress: string, filters?: {
  category?: string
  status?: string
  sort?: "top_rank" | "newest" | "name"
  limit?: number
}) {
  return apiFetch<OwnerAgentsResponse>(
    `/v1/owners/${encodeURIComponent(walletAddress)}/agents${buildQuery(filters)}`,
    {
      method: "GET",
      auth: false,
    }
  )
}

export function fetchAdminDisputes(status: "open" | "accepted" | "rejected" = "open") {
  return apiFetch<AdminMarketDisputesResponse>(
    `/v1/admin/market-disputes${buildQuery({ status })}`,
    {
      method: "GET",
    }
  )
}

export function acceptDispute(disputeId: string, finalOutcome: "YES" | "NO") {
  return apiFetch<AdminMarketDisputesResponse>(
    `/v1/admin/market-disputes/${encodeURIComponent(disputeId)}/accept`,
    {
      method: "POST",
      body: JSON.stringify({
        final_outcome: finalOutcome,
      }),
    }
  )
}

export function rejectDispute(disputeId: string) {
  return apiFetch<AdminMarketDisputesResponse>(
    `/v1/admin/market-disputes/${encodeURIComponent(disputeId)}/reject`,
    {
      method: "POST",
    }
  )
}

export function fetchHealth() {
  return apiFetch<HealthResponse>("/health", {
    method: "GET",
    auth: false,
  })
}

export function refreshFeed(category?: string) {
  return apiFetch<unknown>("/v1/feed/refresh", {
    method: "POST",
    body: JSON.stringify({
      force: true,
      ...(category ? { category } : {}),
    }),
  })
}

export function runCronJob(
  jobId: CronJobId,
  body: Record<string, unknown>,
  cronSecret: string
) {
  return apiFetch<CronRunResult>(`/api/cron/${jobId}`, {
    method: "POST",
    auth: false,
    headers: {
      Authorization: `Bearer ${cronSecret}`,
    },
    body: JSON.stringify(body),
  })
}

export function fetchOnchainConfig() {
  return apiFetch<OnchainConfigResponse>("/v1/admin/system/onchain-config", {
    method: "GET",
  })
}

export function updateTreasuryAuthority(input: UpdateTreasuryAuthorityInput) {
  return apiFetch<UpdateTreasuryAuthorityResponse>(
    "/v1/admin/system/treasury-authority",
    {
      method: "POST",
      body: JSON.stringify(input),
    }
  )
}

function buildQuery(
  params?: Record<string, string | number | boolean | null | undefined>
) {
  if (!params) {
    return ""
  }

  const searchParams = new URLSearchParams()

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return
    }

    searchParams.set(key, String(value))
  })

  const queryString = searchParams.toString()
  return queryString ? `?${queryString}` : ""
}
