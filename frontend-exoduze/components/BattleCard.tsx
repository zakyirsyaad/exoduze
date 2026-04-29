import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
} from "@/components/ui/card"
import { MarketImage } from "@/components/MarketImage"
import { GlareHover } from "./ui/glare-hover"

export type BattleCardProps = {
  title?: string
  badgeLabel?: string
  endsIn?: string
  liquidity?: string
  description?: string
  imageUri?: string | null
  categoryLabel?: string
  topicLabels?: string[]
  alphaLabel?: string
  alphaPercentage?: number
  betaLabel?: string
  betaPercentage?: number
}

export function BattleCard({
  title = "BTC 24h Prediction",
  badgeLabel = "Featured",
  endsIn = "08:12:33",
  liquidity = "$5,200",
  description,
  imageUri,
  categoryLabel,
  topicLabels = [],
}: BattleCardProps) {
  return (
    <GlareHover className="rounded" duration={600}>
      <Card className="w-full max-w-[340px]">
        <CardHeader>
          <div className="flex items-center justify-between">
            {/* <CardTitle>Pro</CardTitle> */}
            <Badge className="rounded">{badgeLabel}</Badge>
          </div>
          <CardDescription>
            Ends in <b>{endsIn}</b>
          </CardDescription>
        </CardHeader>
        <div className="mx-4 aspect-[16/9] overflow-hidden rounded-md bg-muted">
          <MarketImage
            src={imageUri}
            alt={title}
            label={categoryLabel ?? title}
            imageClassName="transition-transform duration-300 group-hover/card:scale-105"
          />
        </div>
        <CardContent className="space-y-3">
          <h1 className="line-clamp-2 text-xl font-semibold">{title}</h1>
          {description ? (
            <p className="line-clamp-2 text-sm leading-6 text-neutral-600 dark:text-neutral-400">
              {description}
            </p>
          ) : null}
          {categoryLabel || topicLabels.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {categoryLabel ? (
                <Badge variant="secondary" className="rounded">
                  {categoryLabel}
                </Badge>
              ) : null}
              {topicLabels.slice(0, 2).map((topic) => (
                <Badge key={topic} variant="outline" className="rounded">
                  {topic}
                </Badge>
              ))}
            </div>
          ) : null}
        </CardContent>
        <CardFooter>
          <p>
            <b>{liquidity} </b>Total Liquidity
          </p>
        </CardFooter>
      </Card>
    </GlareHover>
  )
}
