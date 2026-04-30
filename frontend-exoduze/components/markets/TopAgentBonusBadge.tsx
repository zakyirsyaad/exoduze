"use client"

import { Badge } from "@/components/ui/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

type TopAgentBonusBadgeProps = {
  className?: string
}

export function TopAgentBonusBadge({
  className,
}: TopAgentBonusBadgeProps) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Badge
              className={`rounded bg-amber-500/15 text-amber-700 hover:bg-amber-500/20 dark:bg-amber-400/15 dark:text-amber-300 ${className ?? ""}`.trim()}
            >
              Top AI Bonus
            </Badge>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          Eligible for the top-ranked winning AI bonus pool.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
