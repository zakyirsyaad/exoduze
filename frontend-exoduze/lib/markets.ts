import type { BattleCardProps } from "@/components/BattleCard"

export type MarketCard = BattleCardProps & {
  slug: string
}

const createMarketSlug = (title: string, index: number) =>
  `${title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")}-${index + 1}`

const baseBattleMarkets: BattleCardProps[] = [
  {
    title: "BTC 24h Prediction",
    badgeLabel: "Featured",
    endsIn: "08:12:33",
    liquidity: "$5,200",
    alphaLabel: "Alpha",
    alphaPercentage: 92,
    betaLabel: "Beta",
    betaPercentage: 8,
  },
  {
    title: "ETH Weekly Outlook",
    badgeLabel: "Hot",
    endsIn: "12:44:09",
    liquidity: "$8,940",
    alphaLabel: "Oracle-X",
    alphaPercentage: 64,
    betaLabel: "Sentinel",
    betaPercentage: 36,
  },
  {
    title: "SOL Momentum Battle",
    badgeLabel: "New",
    endsIn: "03:18:52",
    liquidity: "$3,480",
    alphaLabel: "Claude",
    alphaPercentage: 55,
    betaLabel: "GPT",
    betaPercentage: 45,
  },
  {
    title: "BTC 24h Prediction",
    badgeLabel: "Featured",
    endsIn: "08:12:33",
    liquidity: "$5,200",
    alphaLabel: "Alpha",
    alphaPercentage: 92,
    betaLabel: "Beta",
    betaPercentage: 8,
  },
  {
    title: "ETH Weekly Outlook",
    badgeLabel: "Hot",
    endsIn: "12:44:09",
    liquidity: "$8,940",
    alphaLabel: "Oracle-X",
    alphaPercentage: 64,
    betaLabel: "Sentinel",
    betaPercentage: 36,
  },
  {
    title: "SOL Momentum Battle",
    badgeLabel: "New",
    endsIn: "03:18:52",
    liquidity: "$3,480",
    alphaLabel: "Claude",
    alphaPercentage: 55,
    betaLabel: "GPT",
    betaPercentage: 45,
  },
  {
    title: "BTC 24h Prediction",
    badgeLabel: "Featured",
    endsIn: "08:12:33",
    liquidity: "$5,200",
    alphaLabel: "Alpha",
    alphaPercentage: 92,
    betaLabel: "Beta",
    betaPercentage: 8,
  },
  {
    title: "ETH Weekly Outlook",
    badgeLabel: "Hot",
    endsIn: "12:44:09",
    liquidity: "$8,940",
    alphaLabel: "Oracle-X",
    alphaPercentage: 64,
    betaLabel: "Sentinel",
    betaPercentage: 36,
  },
  {
    title: "SOL Momentum Battle",
    badgeLabel: "New",
    endsIn: "03:18:52",
    liquidity: "$3,480",
    alphaLabel: "Claude",
    alphaPercentage: 55,
    betaLabel: "GPT",
    betaPercentage: 45,
  },
  {
    title: "BTC 24h Prediction",
    badgeLabel: "Featured",
    endsIn: "08:12:33",
    liquidity: "$5,200",
    alphaLabel: "Alpha",
    alphaPercentage: 92,
    betaLabel: "Beta",
    betaPercentage: 8,
  },
  {
    title: "ETH Weekly Outlook",
    badgeLabel: "Hot",
    endsIn: "12:44:09",
    liquidity: "$8,940",
    alphaLabel: "Oracle-X",
    alphaPercentage: 64,
    betaLabel: "Sentinel",
    betaPercentage: 36,
  },
  {
    title: "SOL Momentum Battle",
    badgeLabel: "New",
    endsIn: "03:18:52",
    liquidity: "$3,480",
    alphaLabel: "Claude",
    alphaPercentage: 55,
    betaLabel: "GPT",
    betaPercentage: 45,
  },
  {
    title: "BTC 24h Prediction",
    badgeLabel: "Featured",
    endsIn: "08:12:33",
    liquidity: "$5,200",
    alphaLabel: "Alpha",
    alphaPercentage: 92,
    betaLabel: "Beta",
    betaPercentage: 8,
  },
  {
    title: "ETH Weekly Outlook",
    badgeLabel: "Hot",
    endsIn: "12:44:09",
    liquidity: "$8,940",
    alphaLabel: "Oracle-X",
    alphaPercentage: 64,
    betaLabel: "Sentinel",
    betaPercentage: 36,
  },
  {
    title: "SOL Momentum Battle",
    badgeLabel: "New",
    endsIn: "03:18:52",
    liquidity: "$3,480",
    alphaLabel: "Claude",
    alphaPercentage: 55,
    betaLabel: "GPT",
    betaPercentage: 45,
  },
]

export const battleMarkets: MarketCard[] = baseBattleMarkets.map(
  (market, index) => ({
    ...market,
    slug: createMarketSlug(market.title ?? "market", index),
  })
)

export const getMarketBySlug = (slug: string) =>
  battleMarkets.find((market) => market.slug === slug)
