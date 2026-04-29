import type { Env } from "../../config/env.js";
import { fetchJson } from "../../lib/http.js";
import type { NormalizedFeedItem } from "./feed.types.js";

type NewsApiArticle = {
  source?: {
    id?: string | null;
    name?: string | null;
  } | null;
  author?: string | null;
  title?: string | null;
  description?: string | null;
  url?: string | null;
  urlToImage?: string | null;
  publishedAt?: string | null;
  content?: string | null;
};

type NewsApiResponse = {
  status: "ok" | "error";
  totalResults?: number;
  articles?: NewsApiArticle[];
  code?: string;
  message?: string;
};

const categoryMap: Record<string, string> = {
  finance: "business",
  economy: "business",
  tech: "technology",
  technology: "technology",
  science: "science",
  sports: "sports",
  esports: "sports",
  trending: "general"
};

export class NewsApiClient {
  constructor(private readonly env: Env) {}

  async fetchCategoryHeadlines(
    categorySlug: string,
    options?: { limit?: number; includeCountry?: boolean }
  ): Promise<NormalizedFeedItem[]> {
    if (!this.env.NEWSAPI_API_KEY) {
      return [];
    }

    const category = categoryMap[categorySlug] ?? "general";
    const url = this.createUrl("top-headlines");
    url.searchParams.set("category", category);
    if (options?.includeCountry ?? true) {
      url.searchParams.set("country", this.env.NEWSAPI_COUNTRY);
    }
    url.searchParams.set("pageSize", String(this.normalizeLimit(options?.limit ?? 10)));

    const response = await this.fetchNewsApi(url);
    return this.normalizeArticles(response, "NewsAPI", 1.1);
  }

  async search(query: string, options?: { limit?: number }): Promise<NormalizedFeedItem[]> {
    if (!this.env.NEWSAPI_API_KEY) {
      return [];
    }

    const url = this.createUrl("everything");
    url.searchParams.set("q", query);
    url.searchParams.set("language", this.env.NEWSAPI_LANGUAGE);
    url.searchParams.set("sortBy", "publishedAt");
    url.searchParams.set("pageSize", String(this.normalizeLimit(options?.limit ?? 10)));

    const response = await this.fetchNewsApi(url);
    return this.normalizeArticles(response, "NewsAPI", 1.2);
  }

  private createUrl(path: string) {
    const baseUrl = this.env.NEWSAPI_BASE_URL.endsWith("/")
      ? this.env.NEWSAPI_BASE_URL
      : `${this.env.NEWSAPI_BASE_URL}/`;

    return new URL(path, baseUrl);
  }

  private async fetchNewsApi(url: URL) {
    const response = await fetchJson<NewsApiResponse>(url.toString(), {
      headers: {
        "X-Api-Key": this.env.NEWSAPI_API_KEY ?? ""
      }
    });

    if (response.status === "error") {
      throw new Error(`NewsAPI ${response.code ?? "error"}: ${response.message ?? "Request failed."}`);
    }

    return response;
  }

  private normalizeArticles(response: NewsApiResponse, fallbackSourceName: string, mentionWeight: number) {
    return (response.articles ?? []).flatMap((article): NormalizedFeedItem[] => {
      if (!article.title || !article.url || !article.publishedAt || article.title === "[Removed]") {
        return [];
      }

      return [
        {
          sourceName: article.source?.name?.trim() || fallbackSourceName,
          sourceUrl: article.source?.name ? undefined : "https://newsapi.org",
          title: article.title,
          summary: article.description ?? article.content ?? undefined,
          url: article.url,
          imageUri: article.urlToImage ?? undefined,
          publishedAt: article.publishedAt,
          isBreaking: true,
          mentionWeight,
          rawPayload: article
        }
      ];
    });
  }

  private normalizeLimit(limit: number) {
    return Math.min(Math.max(Math.trunc(limit), 1), 100);
  }
}
