"use client"

import type { BattleStrategyPreset } from "@/hooks/Type"
import {
  createDefaultStrategyWeights,
  formatPresetLabel,
  rebalanceWeights,
  STRATEGY_PRESET_OPTIONS,
  sumWeights,
  type StrategyWeights,
} from "@/lib/battle-config"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type StrategyConfiguratorProps = {
  disabled?: boolean
  optionalInsight: string
  preset: BattleStrategyPreset
  weights: StrategyWeights
  onInsightChange: (value: string) => void
  onPresetChange: (preset: BattleStrategyPreset, weights: StrategyWeights) => void
  onWeightsChange: (weights: StrategyWeights) => void
}

const weightLabels: Array<{
  key: keyof StrategyWeights
  label: string
}> = [
  { key: "technicalWeight", label: "Technical" },
  { key: "newsWeight", label: "News" },
  { key: "sentimentWeight", label: "Sentiment" },
  { key: "macroWeight", label: "Macro" },
  { key: "onchainWeight", label: "Onchain" },
]

export function StrategyConfigurator({
  disabled = false,
  optionalInsight,
  preset,
  weights,
  onInsightChange,
  onPresetChange,
  onWeightsChange,
}: StrategyConfiguratorProps) {
  const total = sumWeights(weights)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Configure battle strategy</CardTitle>
        <CardDescription>
          Keep your strategy structured and limited. Signal weights must total
          100.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-2">
          <Label htmlFor="strategy-preset">Strategy Preset</Label>
          <Select
            value={preset}
            onValueChange={(value) =>
              onPresetChange(
                value as BattleStrategyPreset,
                createDefaultStrategyWeights(value as BattleStrategyPreset)
              )
            }
            disabled={disabled}
          >
            <SelectTrigger id="strategy-preset">
              <SelectValue placeholder="Select a preset" />
            </SelectTrigger>
            <SelectContent>
              {STRATEGY_PRESET_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {formatPresetLabel(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium">Signal weights</p>
            <p
              className={
                total === 100
                  ? "text-sm text-emerald-600 dark:text-emerald-400"
                  : "text-sm text-destructive"
              }
            >
              Total {total}/100
            </p>
          </div>

          {weightLabels.map((item) => (
            <WeightControl
              key={item.key}
              disabled={disabled}
              label={item.label}
              value={weights[item.key]}
              onChange={(value) =>
                onWeightsChange(rebalanceWeights(weights, item.key, value))
              }
            />
          ))}
        </div>

        <div className="grid gap-2">
          <Label htmlFor="optional-insight">Optional Insight</Label>
          <textarea
            id="optional-insight"
            maxLength={280}
            value={optionalInsight}
            onChange={(event) => onInsightChange(event.target.value)}
            placeholder="Optional market insight, edge, or caution for this battle."
            className="min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled}
          />
          <p className="text-right text-xs text-neutral-500">
            {optionalInsight.length}/280
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

function WeightControl({
  disabled,
  label,
  onChange,
  value,
}: {
  disabled: boolean
  label: string
  onChange: (value: number) => void
  value: number
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <Label>{label}</Label>
        <Input
          type="number"
          min={0}
          max={100}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="h-9 w-20"
          disabled={disabled}
        />
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-emerald-600"
        disabled={disabled}
      />
    </div>
  )
}
