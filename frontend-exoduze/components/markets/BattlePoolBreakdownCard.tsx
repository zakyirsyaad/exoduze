import type { BattlePool } from "@/hooks/Type"
import { formatCurrency } from "@/components/layouts/markets/market-detail-helpers"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

type BattlePoolBreakdownCardProps = {
  pool: BattlePool
  settlementAsset?: string
}

export function BattlePoolBreakdownCard({
  pool,
  settlementAsset = "USDC",
}: BattlePoolBreakdownCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Pool Breakdown</CardTitle>
        <CardDescription>
          Final payout depends on the winning pool at settlement.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="grid grid-cols-2 gap-3">
          <Metric label="Entries" value={String(pool.total_entries)} />
          <Metric
            label="Locked stake"
            value={formatCurrency(pool.total_staked_usdc, settlementAsset)}
          />
        </div>

        <div className="space-y-3">
          {pool.pools.length ? (
            pool.pools.map((entry) => (
              <div
                key={entry.direction}
                className="rounded-xl border border-black/10 px-3 py-3 dark:border-white/10"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium">{entry.direction.toUpperCase()}</p>
                  <p>{entry.entry_count} entries</p>
                </div>
                <p className="mt-2 text-neutral-500">
                  {formatCurrency(entry.total_stake_usdc, settlementAsset)}
                </p>
              </div>
            ))
          ) : (
            <p className="text-neutral-500">No locked predictions yet.</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-black/10 px-3 py-3 dark:border-white/10">
      <p className="text-neutral-500">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  )
}
