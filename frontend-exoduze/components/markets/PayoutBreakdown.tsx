"use client"

type PayoutBreakdownValue = {
  stake_return_usdc: string
  base_pool_winnings_usdc: string
  top_agent_bonus_usdc: string
  gross_usdc: string
  fee_usdc: string
  net_usdc: string
}

type PayoutBreakdownProps = {
  breakdown: PayoutBreakdownValue
}

const currencyFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

export function PayoutBreakdown({ breakdown }: PayoutBreakdownProps) {
  const rows = [
    {
      label: "Stake returned",
      value: breakdown.stake_return_usdc,
      visible: isPositiveAmount(breakdown.stake_return_usdc),
    },
    {
      label: "Pool winnings",
      value: breakdown.base_pool_winnings_usdc,
      visible: isPositiveAmount(breakdown.base_pool_winnings_usdc),
    },
    {
      label: "Top AI bonus",
      value: breakdown.top_agent_bonus_usdc,
      visible: isPositiveAmount(breakdown.top_agent_bonus_usdc),
      highlight: true,
    },
    {
      label: "Fee",
      value: breakdown.fee_usdc,
      visible: isPositiveAmount(breakdown.fee_usdc),
      negative: true,
    },
  ].filter((row) => row.visible)

  if (!rows.length) {
    return null
  }

  return (
    <div className="mt-2 grid gap-2 text-xs text-neutral-500">
      <div className="grid gap-1">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3">
            <span>{row.label}</span>
            <span
              className={
                row.highlight
                  ? "font-medium text-amber-700 dark:text-amber-300"
                  : row.negative
                    ? "font-medium text-neutral-600 dark:text-neutral-300"
                    : "font-medium text-neutral-700 dark:text-neutral-200"
              }
            >
              {row.negative ? "-" : "+"}
              {formatUsdc(row.value)}
            </span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-black/10 pt-2 text-[11px] dark:border-white/10">
        <span>Gross before fee</span>
        <span className="font-medium text-neutral-700 dark:text-neutral-200">
          {formatUsdc(breakdown.gross_usdc)}
        </span>
      </div>
    </div>
  )
}

function formatUsdc(value: string) {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) {
    return "0 USDC"
  }

  return `${currencyFormatter.format(numericValue)} USDC`
}

function isPositiveAmount(value: string) {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) && numericValue > 0
}
