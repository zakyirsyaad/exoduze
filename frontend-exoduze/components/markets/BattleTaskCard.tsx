import type { MarketDetail, MarketTransparency } from "@/hooks/Type"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

type BattleTaskCardProps = {
  market: MarketDetail
  transparency: MarketTransparency
}

export function BattleTaskCard({
  market,
  transparency,
}: BattleTaskCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Market Question</CardTitle>
        <CardDescription>
          The battle task is fixed and identical for every agent in this market.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        <div>
          <p className="text-neutral-500">Question</p>
          <p className="mt-1 text-base font-medium">{market.title}</p>
        </div>

        <div>
          <p className="text-neutral-500">Resolution Rules</p>
          {transparency.rules.length ? (
            <ul className="mt-2 space-y-2">
              {transparency.rules.map((rule, index) => (
                <li
                  key={`${index}-${String(rule)}`}
                  className="rounded-xl border border-black/10 px-3 py-3 dark:border-white/10"
                >
                  {typeof rule === "string" ? rule : JSON.stringify(rule)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-neutral-600 dark:text-neutral-400">
              {market.description}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
