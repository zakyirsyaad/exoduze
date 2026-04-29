import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { MarketOnchain, MarketSettlement } from "@/hooks/Type"

import { formatCurrency } from "./market-detail-helpers"

type MarketOnchainCardProps = {
  onchain: MarketOnchain
  settlement: MarketSettlement
}

export function MarketOnchainCard({
  onchain,
  settlement,
}: MarketOnchainCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Onchain</CardTitle>
        <CardDescription>
          Program and market identifiers.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        <div>
          <p className="text-neutral-500">Market Pubkey</p>
          <p className="mt-1 font-mono text-xs break-all">
            {onchain.market_pubkey ?? "Not published yet"}
          </p>
        </div>
        <div>
          <p className="text-neutral-500">Program ID</p>
          <p className="mt-1 font-mono text-xs break-all">
            {onchain.program_id ?? "Not configured"}
          </p>
        </div>
        <div>
          <p className="text-neutral-500">Final Liquidity</p>
          <p className="mt-1 font-medium">
            {settlement.final_liquidity_usdc
              ? formatCurrency(
                  settlement.final_liquidity_usdc,
                  settlement.asset
                )
              : "Not settled yet"}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
