"use client"

import Link from "next/link"
import { HugeiconsIcon } from "@hugeicons/react"
import { Wallet01Icon } from "@hugeicons/core-free-icons"

import { PayoutBreakdown } from "@/components/markets/PayoutBreakdown"
import { TopAgentBonusBadge } from "@/components/markets/TopAgentBonusBadge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import type { PortfolioPayout } from "@/hooks/Type"
import { useMediaQuery } from "@/hooks/use-media-query"

type ClaimPayoutDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  payout: PortfolioPayout | null
  submitting: boolean
  onConfirm: () => void
  disabledReason?: string | null
}

const currencyFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

export function ClaimPayoutDialog({
  open,
  onOpenChange,
  payout,
  submitting,
  onConfirm,
  disabledReason,
}: ClaimPayoutDialogProps) {
  const isDesktop = useMediaQuery("(min-width: 768px)")

  const handleOpenChange = (nextOpen: boolean) => {
    if (submitting) {
      return
    }

    onOpenChange(nextOpen)
  }

  if (!payout) {
    return null
  }

  const content = (
    <>
      <ClaimPayoutDialogBody payout={payout} disabledReason={disabledReason} />
      <ClaimPayoutDialogFooter
        disabledReason={disabledReason}
        onCancel={() => handleOpenChange(false)}
        onConfirm={onConfirm}
        submitting={submitting}
      />
    </>
  )

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className="sm:max-w-[520px]"
          showCloseButton={!submitting}
        >
          <DialogHeader>
            <DialogTitle>Confirm payout claim</DialogTitle>
            <DialogDescription>
              Review the final payout breakdown before signing the wallet
              transaction.
            </DialogDescription>
          </DialogHeader>
          {content}
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Drawer open={open} onOpenChange={handleOpenChange}>
      <DrawerContent>
        <DrawerHeader className="text-left">
          <DrawerTitle>Confirm payout claim</DrawerTitle>
          <DrawerDescription>
            Review the final payout breakdown before signing the wallet
            transaction.
          </DrawerDescription>
        </DrawerHeader>
        <div className="grid gap-4 overflow-y-auto px-4 pb-2">
          <ClaimPayoutDialogBody
            payout={payout}
            disabledReason={disabledReason}
          />
        </div>
        <DrawerFooter className="pt-2">
          <ClaimPayoutDialogFooter
            disabledReason={disabledReason}
            onCancel={() => handleOpenChange(false)}
            onConfirm={onConfirm}
            submitting={submitting}
          />
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

function ClaimPayoutDialogBody({
  payout,
  disabledReason,
}: {
  payout: PortfolioPayout
  disabledReason?: string | null
}) {
  const claimableTotal = payout.breakdown?.net_usdc ?? payout.net_usdc

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 rounded-md border border-black/10 p-3 dark:border-white/10">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/markets/${payout.market.slug}`}
                className="font-medium hover:underline"
              >
                {payout.market.title}
              </Link>
              {payout.top_bonus_eligible ? <TopAgentBonusBadge /> : null}
            </div>
            <p className="mt-1 text-sm text-neutral-500">{payout.agent.name}</p>
          </div>
          <Badge variant="outline" className="rounded">
            {formatLabel(payout.status)}
          </Badge>
        </div>

        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-normal text-neutral-500">
            Claimable total
          </p>
          <p className="text-2xl font-semibold">{formatUsdc(claimableTotal)}</p>
        </div>

        {payout.breakdown ? (
          <PayoutBreakdown breakdown={payout.breakdown} />
        ) : (
          <FallbackPayoutBreakdown
            feeUsdc={payout.fee_usdc}
            grossUsdc={payout.gross_usdc}
          />
        )}
      </div>

      <div className="rounded-md border border-dashed border-black/10 p-3 text-sm text-neutral-600 dark:border-white/10 dark:text-neutral-300">
        A wallet prompt will ask you to approve this claim. Once the
        transaction is submitted, the payout status here will refresh.
      </div>

      {disabledReason ? (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-300">
          {disabledReason}
        </div>
      ) : null}
    </div>
  )
}

function ClaimPayoutDialogFooter({
  disabledReason,
  onCancel,
  onConfirm,
  submitting,
}: {
  disabledReason?: string | null
  onCancel: () => void
  onConfirm: () => void
  submitting: boolean
}) {
  return (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
        Cancel
      </Button>
      <Button
        type="button"
        onClick={onConfirm}
        disabled={Boolean(disabledReason) || submitting}
      >
        <HugeiconsIcon icon={Wallet01Icon} />
        {submitting ? "Claiming" : "Confirm claim"}
      </Button>
    </div>
  )
}

function FallbackPayoutBreakdown({
  feeUsdc,
  grossUsdc,
}: {
  feeUsdc: string
  grossUsdc: string
}) {
  return (
    <div className="mt-2 grid gap-2 text-xs text-neutral-500">
      <div className="flex items-center justify-between gap-3">
        <span>Gross before fee</span>
        <span className="font-medium text-neutral-700 dark:text-neutral-200">
          {formatUsdc(grossUsdc)}
        </span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span>Fee</span>
        <span className="font-medium text-neutral-600 dark:text-neutral-300">
          -{formatUsdc(feeUsdc)}
        </span>
      </div>
    </div>
  )
}

function formatUsdc(value: string | null | undefined) {
  const numericValue = Number(value ?? 0)

  if (!Number.isFinite(numericValue)) {
    return "0 USDC"
  }

  return `${currencyFormatter.format(numericValue)} USDC`
}

function formatLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}
