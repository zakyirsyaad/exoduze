import type { BattleEntry } from "@/hooks/Type"
import { formatCurrency, formatConfidence } from "@/components/layouts/markets/market-detail-helpers"
import { formatPresetLabel } from "@/lib/battle-config"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

type PredictionPreviewProps = {
  entry: BattleEntry
  settlementAsset?: string
}

export function PredictionPreview({
  entry,
  settlementAsset = "USDC",
}: PredictionPreviewProps) {
  const prediction = entry.prediction_json

  return (
    <Card className="border border-black/5 bg-white/80 dark:border-white/10 dark:bg-white/5">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{entry.agent.name}</CardTitle>
            <CardDescription>
              {formatPresetLabel(entry.strategy.preset)} strategy
            </CardDescription>
          </div>
          <Badge
            variant={entry.status === "locked" ? "secondary" : "outline"}
            className="rounded"
          >
            {entry.status === "locked" ? "Prediction locked" : entry.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="grid gap-3 md:grid-cols-3">
          <Metric label="Direction" value={String(prediction.direction).toUpperCase()} />
          <Metric
            label="Predicted Value"
            value={String(prediction.predictedValue)}
          />
          <Metric
            label="Confidence"
            value={formatConfidence(prediction.confidence)}
          />
          <Metric
            label="Stake"
            value={formatCurrency(entry.stake_amount, settlementAsset)}
          />
          <Metric
            label="Technical"
            value={`${entry.strategy.technical_weight}%`}
          />
          <Metric label="News" value={`${entry.strategy.news_weight}%`} />
        </div>

        <div>
          <p className="text-neutral-500">Reasoning summary</p>
          <p className="mt-1 leading-6">{prediction.reasoningSummary}</p>
        </div>

        <div>
          <p className="text-neutral-500">Risk notes</p>
          <p className="mt-1 leading-6 text-neutral-600 dark:text-neutral-400">
            {prediction.riskNotes}
          </p>
        </div>

        {entry.strategy.optional_insight ? (
          <div>
            <p className="text-neutral-500">Optional insight</p>
            <p className="mt-1 leading-6 text-neutral-600 dark:text-neutral-400">
              {entry.strategy.optional_insight}
            </p>
          </div>
        ) : null}

        <p className="text-xs break-all text-neutral-500">
          Prediction hash: {entry.prediction_hash}
        </p>
      </CardContent>
    </Card>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.16em] text-neutral-500">
        {label}
      </p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  )
}
