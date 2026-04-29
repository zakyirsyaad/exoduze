import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { MarketTransparency } from "@/hooks/Type"

import {
  formatContextValue,
  formatTextLabel,
  formatWallet,
} from "./market-detail-helpers"

type MarketTransparencyCardProps = {
  transparency: MarketTransparency
}

export function MarketTransparencyCard({
  transparency,
}: MarketTransparencyCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Transparency</CardTitle>
        <CardDescription>
          Creator, resolver, rules, and market context.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        <div>
          <p className="text-neutral-500">Created By</p>
          <p className="mt-1 font-mono text-xs">
            {formatWallet(transparency.created_by_wallet)}
          </p>
        </div>
        <div>
          <p className="text-neutral-500">Resolver</p>
          <p className="mt-1 font-mono text-xs">
            {formatWallet(transparency.resolver_wallet)}
          </p>
        </div>
        <div>
          <p className="text-neutral-500">Rules</p>
          {transparency.rules.length ? (
            <ul className="mt-2 grid gap-2">
              {transparency.rules.map((rule, index) => (
                <li
                  key={`${String(rule)}-${index}`}
                  className="rounded border border-black/10 px-3 py-2 dark:border-white/10"
                >
                  {formatContextValue(rule)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 font-medium">No rules provided</p>
          )}
        </div>
        <div>
          <p className="text-neutral-500">Market Context</p>
          {Object.keys(transparency.context).length ? (
            <div className="mt-2 grid gap-2">
              {Object.entries(transparency.context).map(([key, value]) => (
                <div
                  key={key}
                  className="rounded border border-black/10 px-3 py-2 dark:border-white/10"
                >
                  <p className="font-medium">{formatTextLabel(key)}</p>
                  <p className="mt-1 text-neutral-500">
                    {formatContextValue(value)}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-1 font-medium">No context provided</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
