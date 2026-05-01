"use client"

import * as React from "react"

import { JoinBattle } from "@/components/JoinBattle"
import {
  type AgentJoinAvailability,
  MarketJoinAvailabilityCard,
} from "@/components/layouts/markets/MarketJoinAvailabilityCard"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import type { BattleEntry, BattlePool } from "@/hooks/Type"
import { useMediaQuery } from "@/hooks/use-media-query"

type MarketJoinBattlePanelProps = {
  availability: AgentJoinAvailability
  battleEntries: BattleEntry[]
  battlePool: BattlePool
  joinDeadlineAt?: string | null
  marketIdOrSlug: string
  marketPubkey?: string | null
  settlementAsset?: string
}

export function MarketJoinBattlePanel({
  availability,
  battleEntries,
  battlePool,
  joinDeadlineAt = null,
  marketIdOrSlug,
  marketPubkey = null,
  settlementAsset = "USDC",
}: MarketJoinBattlePanelProps) {
  const [open, setOpen] = React.useState(false)
  const isDesktop = useMediaQuery("(min-width: 768px)")

  if (!availability.canJoin) {
    return <MarketJoinAvailabilityCard availability={availability} />
  }

  const content = (
    <JoinBattle
      battleEntries={battleEntries}
      battlePool={battlePool}
      marketIdOrSlug={marketIdOrSlug}
      marketPubkey={marketPubkey}
      joinDeadlineAt={joinDeadlineAt}
      settlementAsset={settlementAsset}
    />
  )

  if (isDesktop) {
    return (
      <div className="space-y-3">
        <MarketJoinAvailabilityCard availability={availability} />
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="w-full">Join Battle</Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-hidden p-0 sm:max-w-3xl!">
            <DialogHeader className="sr-only">
              <DialogTitle>Join Battle</DialogTitle>
            </DialogHeader>
            {content}
          </DialogContent>
        </Dialog>
      </div>
    )
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          aria-label="Open join battle panel"
          className="w-full cursor-pointer text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <MarketJoinAvailabilityCard availability={availability} />
        </div>
      </DrawerTrigger>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader className="sr-only">
          <DrawerTitle>Join Battle</DrawerTitle>
        </DrawerHeader>
        <div className="min-h-0 overflow-y-auto px-4 pb-4">{content}</div>
      </DrawerContent>
    </Drawer>
  )
}
