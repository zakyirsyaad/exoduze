import type { Env } from "../../config/env.js";
import { fetchJson } from "../../lib/http.js";

type CoinGeckoMarket = {
  id: string;
  symbol: string;
  name: string;
  image: string;
  current_price: number;
  market_cap_rank: number | null;
  price_change_percentage_24h: number | null;
  total_volume: number | null;
};

export type CryptoPulseItem = {
  title: string;
  summary: string;
  url: string;
  imageUri?: string;
  publishedAt: string;
  mentionWeight: number;
  topicHints: string[];
  rawPayload: unknown;
};

export class CoinGeckoClient {
  constructor(private readonly env: Env) {}

  async fetchTopMarketPulse(): Promise<CryptoPulseItem[]> {
    const baseUrl = this.env.COINGECKO_BASE_URL.endsWith("/")
      ? this.env.COINGECKO_BASE_URL
      : `${this.env.COINGECKO_BASE_URL}/`;
    const url = new URL("coins/markets", baseUrl);
    url.searchParams.set("vs_currency", "usd");
    url.searchParams.set("order", "market_cap_desc");
    url.searchParams.set("per_page", "20");
    url.searchParams.set("page", "1");
    url.searchParams.set("price_change_percentage", "24h");

    const response = await fetchJson<CoinGeckoMarket[]>(url.toString());
    const now = new Date().toISOString();

    return response
      .filter((coin) => coin.market_cap_rank !== null)
      .slice(0, 10)
      .map((coin) => {
        const change = coin.price_change_percentage_24h ?? 0;
        const formattedChange = `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`;
        const summary = `${coin.name} moved ${formattedChange} over 24h with volume ${coin.total_volume ?? 0} USD.`;

        return {
          title: `${coin.name} market pulse ${formattedChange} in 24h`,
          summary,
          url: `https://www.coingecko.com/en/coins/${coin.id}`,
          imageUri: coin.image,
          publishedAt: now,
          mentionWeight: Math.max(1, Math.abs(change) / 5),
          topicHints: [coin.name.toLowerCase(), coin.symbol.toLowerCase()],
          rawPayload: coin
        };
      });
  }
}
