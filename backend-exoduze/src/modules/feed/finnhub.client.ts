import type { Env } from "../../config/env.js";
import { fetchJson } from "../../lib/http.js";
import type { NormalizedFeedItem } from "./feed.types.js";

type FinnhubNewsItem = {
  category?: string;
  datetime: number;
  headline: string;
  id: number;
  image?: string;
  related?: string;
  source?: string;
  summary?: string;
  url: string;
};

type DateRange = {
  from: string;
  to: string;
};

export class FinnhubClient {
  constructor(private readonly env: Env) {}

  async fetchCompanyNews(symbol: string, dateRange: DateRange, limit = 20): Promise<NormalizedFeedItem[]> {
    if (!this.env.FINNHUB_API_KEY) {
      return [];
    }

    const url = this.createUrl("company-news");
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("from", dateRange.from);
    url.searchParams.set("to", dateRange.to);
    url.searchParams.set("token", this.env.FINNHUB_API_KEY);

    const response = await fetchJson<FinnhubNewsItem[]>(url.toString());
    return response
      .sort((left, right) => right.datetime - left.datetime)
      .slice(0, limit)
      .map((item) => this.normalizeItem(item, 1.3));
  }

  async fetchMarketNews(category: string, limit = 10): Promise<NormalizedFeedItem[]> {
    if (!this.env.FINNHUB_API_KEY) {
      return [];
    }

    const url = this.createUrl("news");
    url.searchParams.set("category", category);
    url.searchParams.set("token", this.env.FINNHUB_API_KEY);

    const response = await fetchJson<FinnhubNewsItem[]>(url.toString());
    return response
      .sort((left, right) => right.datetime - left.datetime)
      .slice(0, limit)
      .map((item) => this.normalizeItem(item, 1.2));
  }

  private createUrl(path: string) {
    const baseUrl = this.env.FINNHUB_BASE_URL.endsWith("/")
      ? this.env.FINNHUB_BASE_URL
      : `${this.env.FINNHUB_BASE_URL}/`;

    return new URL(path, baseUrl);
  }

  private normalizeItem(item: FinnhubNewsItem, mentionWeight: number): NormalizedFeedItem {
    return {
      sourceName: item.source?.trim() || "Finnhub",
      sourceUrl: "https://finnhub.io",
      title: item.headline,
      summary: item.summary,
      url: item.url,
      imageUri: item.image,
      publishedAt: new Date(item.datetime * 1000).toISOString(),
      isBreaking: true,
      mentionWeight,
      rawPayload: item
    };
  }
}
