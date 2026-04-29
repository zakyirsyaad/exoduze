"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useWallet } from "@solana/react-hooks"
import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ShineBorder } from "@/components/ui/shine-border"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useAuth } from "@/hooks/useAuth"
import { useOpenPosition } from "@/hooks/useOpenPosition"
import type { MarketAgent, MarketDetail, MarketUserContext } from "@/hooks/Type"
import { apiFetch } from "@/lib/api"
import {
  deriveAssociatedTokenAddress,
  ExoduzeProgramUnavailableError,
  getExoduzeProgramConfig,
  isValidSolanaPublicKey,
} from "@/lib/exoduze-program"
import { formatMarketStatusLabel } from "@/lib/market-formatters"
import {
  MARKET_DETAIL_REFRESH_EVENT,
  type MarketDetailRefreshEventDetail,
} from "@/lib/market-events"
import {
  formatOnchainSyncRefs,
  isAmbiguousTransactionSubmissionError,
  isPendingOnchainSyncError,
  type OnchainSyncRefs,
  syncOnchainTransactionWithRetry,
} from "@/lib/onchain-sync"
import { isApiDateSameOrBeforeNow } from "@/lib/time-formatters"

type StakeProps = {
  agents: MarketAgent[]
  market: MarketDetail
  userContext?: MarketUserContext | null
}

type StakeTransactionRefs = OnchainSyncRefs

type SettlementTokenBalance = {
  tokenAccount: string
  uiAmount: number
}

const TOKEN_DECIMALS = 6
const DEVNET_RPC_URL = "https://api.devnet.solana.com"
const MIN_NATIVE_SOL_FOR_POSITION = 0.01
const tokenBalanceFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: TOKEN_DECIMALS,
})
const nativeSolBalanceFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 6,
})

export function Stake({ agents, market, userContext = null }: StakeProps) {
  const auth = useAuth()
  const wallet = useWallet()
  const openPosition = useOpenPosition()
  const router = useRouter()
  const [amount, setAmount] = React.useState("")
  const [selectedMarketAgentId, setSelectedMarketAgentId] = React.useState("")
  const [formError, setFormError] = React.useState<string | null>(null)
  const [settlementTokenBalance, setSettlementTokenBalance] =
    React.useState<SettlementTokenBalance | null>(null)
  const [loadingSettlementTokenBalance, setLoadingSettlementTokenBalance] =
    React.useState(false)
  const [settlementTokenBalanceError, setSettlementTokenBalanceError] =
    React.useState<string | null>(null)
  const [nativeSolBalance, setNativeSolBalance] = React.useState<number | null>(
    null
  )
  const [loadingNativeSolBalance, setLoadingNativeSolBalance] =
    React.useState(false)
  const [nativeSolBalanceError, setNativeSolBalanceError] = React.useState<
    string | null
  >(null)
  const ambiguousCommitmentWarnings = React.useMemo(
    () => getAmbiguousCommitmentWarnings(agents),
    [agents]
  )
  const committedAgents = React.useMemo(
    () =>
      agents.filter((agent) => {
        const commitmentRef = getAgentCommitmentRef(agent)
        return (
          commitmentRef !== null &&
          !ambiguousCommitmentWarnings.byCommitmentRef.has(commitmentRef)
        )
      }),
    [agents, ambiguousCommitmentWarnings.byCommitmentRef]
  )
  const connectedWalletAddress =
    wallet.status === "connected"
      ? wallet.session.account.address.toString()
      : null
  const authenticatedWalletAddress = auth.session?.wallet.wallet_address ?? null
  const activeWalletAddress = connectedWalletAddress ?? authenticatedWalletAddress

  const effectiveSelectedMarketAgentId = committedAgents.some(
    (agent) => agent.market_agent_id === selectedMarketAgentId
  )
    ? selectedMarketAgentId
    : (committedAgents[0]?.market_agent_id ?? "")
  const selectedMarketAgent =
    committedAgents.find(
      (agent) => agent.market_agent_id === effectiveSelectedMarketAgentId
    ) ?? null
  const selectedDecisionSide =
    selectedMarketAgent?.current_decision?.side ??
    selectedMarketAgent?.final_decision?.side ??
    null
  const isSelectedDecisionVisible = Boolean(selectedDecisionSide)
  const isDecisionVisibilityLocked =
    market.fairness?.live_agent_decisions_visible === false
  const selectedDecisionLabel =
    selectedDecisionSide ??
    (isDecisionVisibilityLocked ? "Hidden until reveal" : "Pending")
  const selectedAgentCommitmentRef = selectedMarketAgent
    ? getAgentCommitmentRef(selectedMarketAgent)
    : null
  const programConfig = getExoduzeProgramConfig()
  const statusDisabledReason = getMarketStakeDisabledReason(market)
  const onchainDisabledReason = getOnchainStakeDisabledReason(
    market.onchain.market_pubkey,
    programConfig
  )
  const settlementMint = programConfig.settlementMint
  const amountValue = Number(amount)
  const hasValidAmount = Number.isFinite(amountValue) && amountValue > 0
  const hasInsufficientSettlementBalance =
    hasValidAmount &&
    settlementTokenBalance !== null &&
    amountValue > settlementTokenBalance.uiAmount
  const hasInsufficientNativeSolBalance =
    nativeSolBalance !== null && nativeSolBalance < MIN_NATIVE_SOL_FOR_POSITION
  const disabledReason =
    statusDisabledReason ??
    onchainDisabledReason ??
    (!connectedWalletAddress
      ? "Connect and sign your wallet to open a position."
      : null) ??
    (!agents.length ? "No participating agents are available yet." : null) ??
    (!committedAgents.length
      ? ambiguousCommitmentWarnings.items.length
        ? "Some participating agents share the same on-chain commitment ref. Follower staking is blocked until those commitments are repaired."
        : "No agents are committed on-chain yet. The agent owner must finish the join transaction first."
      : null) ??
    (!selectedMarketAgent ? "Choose an AI agent." : null) ??
    (!selectedAgentCommitmentRef
      ? "This agent is not committed on-chain yet."
      : null) ??
    (hasInsufficientNativeSolBalance
      ? `Add devnet SOL to this wallet for Solana network fees and account rent. Available: ${formatNativeSolBalance(nativeSolBalance)} SOL.`
      : null) ??
    (!hasValidAmount ? "Enter an amount greater than zero." : null) ??
    (hasInsufficientSettlementBalance
      ? `Insufficient ${market.settlement.asset} balance in the expected devnet token account. Available: ${formatTokenBalance(settlementTokenBalance.uiAmount)} ${market.settlement.asset}.`
      : null)
  const isSubmitDisabled = Boolean(disabledReason) || openPosition.loading
  const positionCount = userContext?.positions.length ?? 0

  React.useEffect(() => {
    let cancelled = false

    const loadSettlementTokenBalance = async () => {
      await Promise.resolve()

      if (!activeWalletAddress || !settlementMint) {
        if (!cancelled) {
          setSettlementTokenBalance(null)
          setSettlementTokenBalanceError(null)
          setLoadingSettlementTokenBalance(false)
          setNativeSolBalance(null)
          setNativeSolBalanceError(null)
          setLoadingNativeSolBalance(false)
        }
        return
      }

      if (
        !isValidSolanaPublicKey(activeWalletAddress) ||
        !isValidSolanaPublicKey(settlementMint)
      ) {
        if (!cancelled) {
          setSettlementTokenBalance(null)
          setSettlementTokenBalanceError(
            "Unable to read settlement token balance."
          )
          setLoadingSettlementTokenBalance(false)
          setNativeSolBalance(null)
          setNativeSolBalanceError("Unable to read native SOL balance.")
          setLoadingNativeSolBalance(false)
        }
        return
      }

      try {
        setLoadingSettlementTokenBalance(true)
        setSettlementTokenBalanceError(null)
        setLoadingNativeSolBalance(true)
        setNativeSolBalanceError(null)

        const connection = new Connection(
          process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? DEVNET_RPC_URL,
          "confirmed"
        )
        const walletPubkey = new PublicKey(activeWalletAddress)
        const tokenAccount = deriveAssociatedTokenAddress(
          activeWalletAddress,
          settlementMint
        )
        const [accountInfo, nativeLamports] = await Promise.all([
          connection.getParsedAccountInfo(new PublicKey(tokenAccount)),
          connection.getBalance(walletPubkey, "confirmed"),
        ])

        if (cancelled) {
          return
        }

        setSettlementTokenBalance({
          tokenAccount,
          uiAmount: getParsedTokenUiAmount(accountInfo.value?.data),
        })
        setNativeSolBalance(nativeLamports / LAMPORTS_PER_SOL)
      } catch (err) {
        if (cancelled) {
          return
        }

        setSettlementTokenBalance(null)
        setSettlementTokenBalanceError(
          err instanceof Error
            ? err.message
            : "Unable to read settlement token balance."
        )
        setNativeSolBalance(null)
        setNativeSolBalanceError(
          err instanceof Error
            ? err.message
            : "Unable to read native SOL balance."
        )
      } finally {
        if (!cancelled) {
          setLoadingSettlementTokenBalance(false)
          setLoadingNativeSolBalance(false)
        }
      }
    }

    void loadSettlementTokenBalance()

    return () => {
      cancelled = true
    }
  }, [activeWalletAddress, settlementMint])

  const ensureAuthSession = React.useCallback(async () => {
    if (
      auth.session &&
      (!connectedWalletAddress ||
        auth.session.wallet.wallet_address === connectedWalletAddress)
    ) {
      return auth.session
    }

    if (wallet.status !== "connected") {
      throw new Error("Connect and sign your wallet to open a position.")
    }

    return auth.loginWithWallet(wallet.session)
  }, [auth, connectedWalletAddress, wallet])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)

    if (disabledReason) {
      setFormError(disabledReason)
      toast.error(disabledReason)
      return
    }

    if (!selectedMarketAgent) {
      return
    }

    const marketPubkey = market.onchain.market_pubkey

    if (!marketPubkey) {
      return
    }

    let stakeAmountBaseUnits: bigint

    try {
      stakeAmountBaseUnits = decimalToBaseUnits(amount, TOKEN_DECIMALS)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Enter a valid amount."
      setFormError(message)
      toast.error(message)
      return
    }

    const toastId = toast.loading("Confirm position transaction...")
    let txSubmitted = false
    let authSession

    const syncPosition = async (refs: StakeTransactionRefs) => {
      await apiFetch(
        `/v1/markets/${encodeURIComponent(
          market.slug
        )}/agents/${encodeURIComponent(selectedMarketAgent.agent.id)}/stake`,
        {
          method: "POST",
          body: JSON.stringify({
            commit_included: false,
            market_agent_id: selectedMarketAgent.market_agent_id,
            onchain_commitment_ref: selectedAgentCommitmentRef,
            onchain_position_ref: requireTransactionRef(
              refs.positionPubkey,
              "position"
            ),
            stake_amount_base_units: stakeAmountBaseUnits.toString(),
            stake_usdc: amount.trim(),
            tx_sig: refs.signature,
            user_token_account: refs.userTokenAccount,
            vault_pubkey: refs.vaultPubkey,
          }),
        }
      )
    }

    try {
      authSession = await ensureAuthSession()

      const transaction = await openPosition.openPosition({
        walletAddress: authSession.wallet.wallet_address,
        marketPubkey,
        marketAgentId: selectedMarketAgent.market_agent_id,
        agentCommitmentPubkey: selectedAgentCommitmentRef,
        stakeAmountBaseUnits,
      })

      txSubmitted = true
      toast.loading("Syncing position...", { id: toastId })

      await syncOnchainTransactionWithRetry({
        context: "open-position sync",
        onRetry: ({ attempt, totalAttempts }) => {
          toast.loading(
            `Waiting for backend to observe position tx... (${attempt}/${totalAttempts})`,
            {
              description: "Devnet/RPC propagation can take a few seconds.",
              id: toastId,
            }
          )
        },
        refs: transaction,
        sync: syncPosition,
      })

      toast.success("Position opened", { id: toastId })
      dispatchMarketDetailRefresh(market.slug)
      router.refresh()
      setAmount("")
    } catch (err) {
      const recoverableRefs = getTransactionRefs(err)
      if (recoverableRefs && canRecoverPositionSync(err, recoverableRefs)) {
        try {
          const refs = recoverableRefs
          toast.loading("Recovering position...", { id: toastId })
          await syncOnchainTransactionWithRetry({
            context: "open-position recovery",
            onRetry: ({ attempt, totalAttempts }) => {
              toast.loading(
                `Recovering position... (${attempt}/${totalAttempts})`,
                {
                  description:
                    "Retrying backend sync while the transaction propagates.",
                  id: toastId,
                }
              )
            },
            refs,
            sync: syncPosition,
          })
          toast.success("Position opened", { id: toastId })
          dispatchMarketDetailRefresh(market.slug)
          router.refresh()
          setAmount("")
          return
        } catch (recoveryError) {
          err = recoveryError
        }
      }

      const message = getOpenPositionErrorMessage(err, txSubmitted)
      setFormError(message)
      toast.error(message, { id: toastId })
    }
  }

  return (
    <Card className="relative overflow-hidden">
      <ShineBorder shineColor="var(--foreground)" />
      <CardHeader>
        <CardTitle>Place Your Position</CardTitle>
        <CardDescription>
          {positionCount
            ? `${positionCount} wallet position${positionCount === 1 ? "" : "s"} in this market.`
            : "Choose a participating AI agent and stake."}
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="agent">Select AI Agent</Label>
              <Select
                value={effectiveSelectedMarketAgentId}
                onValueChange={(value) => {
                  setSelectedMarketAgentId(value)
                  setFormError(null)
                }}
                disabled={!committedAgents.length || openPosition.loading}
              >
                <SelectTrigger id="agent" className="w-full">
                  <SelectValue placeholder="Choose agent" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {committedAgents.map((marketAgent) => {
                      const side =
                        marketAgent.current_decision?.side ??
                        marketAgent.final_decision?.side ??
                        (isDecisionVisibilityLocked ? "Hidden" : "Pending")

                      return (
                        <SelectItem
                          key={marketAgent.market_agent_id}
                          value={marketAgent.market_agent_id}
                        >
                          {marketAgent.agent.name} - {side}
                        </SelectItem>
                      )
                    })}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            {selectedMarketAgent ? (
              <div className="rounded-md border border-black/10 p-3 text-sm dark:border-white/10">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-medium">
                    {selectedMarketAgent.agent.name}
                  </p>
                  <p className="font-medium">{selectedDecisionLabel}</p>
                </div>
                <p className="mt-2 line-clamp-3 text-neutral-500">
                  {isSelectedDecisionVisible
                    ? (selectedMarketAgent.current_decision?.reason_summary ??
                      selectedMarketAgent.final_decision?.reason_summary ??
                      selectedMarketAgent.agent.description)
                    : "This agent has an on-chain commitment, but the market decision is not visible yet."}
                </p>
              </div>
            ) : null}

            {ambiguousCommitmentWarnings.items.length ? (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
                <p className="font-medium text-amber-700 dark:text-amber-300">
                  Ambiguous On-Chain Commitments
                </p>
                <div className="mt-2 grid gap-2 text-neutral-700 dark:text-neutral-300">
                  {ambiguousCommitmentWarnings.items.map((warning) => (
                    <p key={warning.commitmentRef}>
                      {warning.agentNames.join(", ")} share{" "}
                      {warning.commitmentRef}. Follower staking is disabled for
                      those agents until the commitment mapping is repaired.
                    </p>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="grid gap-2">
              <Label htmlFor="amount">Amount</Label>
              <Input
                id="amount"
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={amount}
                onChange={(event) => {
                  setAmount(event.target.value)
                  setFormError(null)
                }}
                placeholder={`0.00 ${market.settlement.asset}`}
                disabled={openPosition.loading}
              />
              <p className="text-sm text-muted-foreground">
                Settlement asset:{" "}
                <span className="font-medium text-foreground">
                  {market.settlement.asset}
                </span>
              </p>
              <p className="text-sm text-muted-foreground">
                Wallet balance:{" "}
                <span className="font-medium text-foreground">
                  {getSettlementBalanceLabel({
                    balance: settlementTokenBalance,
                    error: settlementTokenBalanceError,
                    loading: loadingSettlementTokenBalance,
                    settlementAsset: market.settlement.asset,
                  })}
                </span>
              </p>
              <p className="text-sm text-muted-foreground">
                Native SOL balance:{" "}
                <span className="font-medium text-foreground">
                  {getNativeSolBalanceLabel({
                    balance: nativeSolBalance,
                    error: nativeSolBalanceError,
                    loading: loadingNativeSolBalance,
                  })}
                </span>
              </p>
              {settlementMint ? (
                <p className="text-xs break-all text-muted-foreground">
                  Mint: {settlementMint}
                </p>
              ) : null}
            </div>

            {formError ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {formError}
              </p>
            ) : disabledReason ? (
              <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                {disabledReason}
              </p>
            ) : null}
          </div>
        </CardContent>
        <CardFooter>
          <Button type="submit" className="w-full" disabled={isSubmitDisabled}>
            {openPosition.loading ? "Opening..." : "Open Position"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}

function getAgentCommitmentRef(agent: MarketAgent) {
  const commitmentRef = agent.commitment.onchain_commitment_ref ?? null

  if (!commitmentRef || !isValidSolanaPublicKey(commitmentRef)) {
    return null
  }

  return commitmentRef
}

function getAmbiguousCommitmentWarnings(agents: MarketAgent[]) {
  const commitmentGroups = new Map<string, MarketAgent[]>()

  for (const agent of agents) {
    const commitmentRef = getAgentCommitmentRef(agent)

    if (!commitmentRef) {
      continue
    }

    const group = commitmentGroups.get(commitmentRef) ?? []
    group.push(agent)
    commitmentGroups.set(commitmentRef, group)
  }

  const items = [...commitmentGroups.entries()]
    .filter(([, groupedAgents]) => groupedAgents.length > 1)
    .map(([commitmentRef, groupedAgents]) => ({
      commitmentRef,
      agentNames: groupedAgents.map((agent) => agent.agent.name),
    }))

  return {
    byCommitmentRef: new Map(items.map((item) => [item.commitmentRef, item])),
    items,
  }
}

function getMarketStakeDisabledReason(market: MarketDetail) {
  if (market.status !== "open") {
    return `Market is ${formatMarketStatusLabel(market.status)}.`
  }

  if (
    isApiDateSameOrBeforeNow(
      market.timing.decision_cutoff_at ?? market.timing.closes_at
    )
  ) {
    return "Position window is closed."
  }

  if (isApiDateSameOrBeforeNow(market.timing.closes_at)) {
    return "Market is closed."
  }

  return null
}

function getOnchainStakeDisabledReason(
  marketPubkey: string | null,
  config: ReturnType<typeof getExoduzeProgramConfig>
) {
  if (!marketPubkey) {
    return "Staking is not active for this market yet. The market needs to be published on-chain first."
  }

  if (!isValidSolanaPublicKey(marketPubkey)) {
    return "Staking is not active for this market yet. The market needs a valid on-chain pubkey first."
  }

  if (!config.programId) {
    return "On-chain staking is not configured yet."
  }

  if (!isValidSolanaPublicKey(config.programId)) {
    return "The on-chain program id is invalid."
  }

  if (!config.settlementMint) {
    return "Settlement mint is not configured yet."
  }

  if (!isValidSolanaPublicKey(config.settlementMint)) {
    return "Settlement mint is invalid."
  }

  return null
}

function decimalToBaseUnits(value: string, decimals: number) {
  const trimmedValue = value.trim()

  if (!/^\d+(\.\d+)?$/.test(trimmedValue)) {
    throw new Error("Enter a valid amount.")
  }

  const [wholePart, fractionPart = ""] = trimmedValue.split(".")

  if (fractionPart.length > decimals) {
    throw new Error(`Amount supports up to ${decimals} decimal places.`)
  }

  const wholeUnits = BigInt(wholePart) * BigInt(10) ** BigInt(decimals)
  const fractionUnits = BigInt(fractionPart.padEnd(decimals, "0") || "0")

  return wholeUnits + fractionUnits
}

function getSettlementBalanceLabel({
  balance,
  error,
  loading,
  settlementAsset,
}: {
  balance: SettlementTokenBalance | null
  error: string | null
  loading: boolean
  settlementAsset: string
}) {
  if (loading) {
    return "Checking..."
  }

  if (error) {
    return "Unavailable"
  }

  if (!balance) {
    return `0 ${settlementAsset}`
  }

  return `${formatTokenBalance(balance.uiAmount)} ${settlementAsset}`
}

function getNativeSolBalanceLabel({
  balance,
  error,
  loading,
}: {
  balance: number | null
  error: string | null
  loading: boolean
}) {
  if (loading) {
    return "Checking..."
  }

  if (error) {
    return "Unavailable"
  }

  if (balance === null) {
    return "0 SOL"
  }

  return `${formatNativeSolBalance(balance)} SOL`
}

function formatTokenBalance(value: number) {
  return tokenBalanceFormatter.format(value)
}

function formatNativeSolBalance(value: number) {
  return nativeSolBalanceFormatter.format(value)
}

function getParsedTokenUiAmount(data: unknown) {
  if (!data || typeof data !== "object" || !("parsed" in data)) {
    return 0
  }

  const parsedData = data as ParsedTokenAccountData
  const tokenAmount = parsedData.parsed?.info?.tokenAmount

  if (!tokenAmount) {
    return 0
  }

  if (typeof tokenAmount.uiAmount === "number") {
    return tokenAmount.uiAmount
  }

  const amount = Number(tokenAmount.amount ?? "0")
  const decimals = Number(tokenAmount.decimals ?? TOKEN_DECIMALS)

  if (!Number.isFinite(amount) || !Number.isFinite(decimals)) {
    return 0
  }

  return amount / 10 ** decimals
}

function getOpenPositionErrorMessage(error: unknown, txSubmitted: boolean) {
  const prefix = txSubmitted
    ? "Position tx was submitted, but backend sync failed: "
    : ""
  const transactionRefs = getTransactionRefs(error)
  const diagnosticRefs = formatOnchainSyncRefs(transactionRefs)

  if (error instanceof ExoduzeProgramUnavailableError) {
    return `${prefix}On-chain positions are not available yet.`
  }

  if (isPendingOnchainSyncError(error)) {
    const diagnosticSuffix = diagnosticRefs ? ` (${diagnosticRefs})` : ""

    return `${prefix}Backend has not observed the position yet. If your wallet shows the transaction as confirmed, wait a few seconds and refresh the market.${diagnosticSuffix}`
  }

  if (
    !txSubmitted &&
    transactionRefs &&
    !transactionRefs.signature &&
    isAmbiguousTransactionSubmissionError(error)
  ) {
    const diagnosticSuffix = diagnosticRefs ? ` (${diagnosticRefs})` : ""

    return `${prefix}The wallet did not return a position transaction signature yet. Check your wallet activity, SOL fee balance, and settlement token balance, then try again.${diagnosticSuffix}`
  }

  const message =
    error instanceof Error ? error.message : "Unable to open position."

  return diagnosticRefs
    ? `${prefix}${message} (${diagnosticRefs})`
    : `${prefix}${message}`
}

type ParsedTokenAccountData = {
  parsed?: {
    info?: {
      tokenAmount?: {
        amount?: string
        decimals?: number
        uiAmount?: number | null
      }
    }
  }
}

function requireTransactionRef(value: string | undefined, label: string) {
  if (!value) {
    throw new Error(`Missing on-chain ${label} reference from transaction.`)
  }

  return value
}

function getTransactionRefs(error: unknown): StakeTransactionRefs | null {
  if (!error || typeof error !== "object" || !("transactionRefs" in error)) {
    return null
  }

  const refs = (error as { transactionRefs?: unknown }).transactionRefs

  if (!refs || typeof refs !== "object") {
    return null
  }

  return refs as StakeTransactionRefs
}

function canRecoverPositionSync(
  error: unknown,
  refs: StakeTransactionRefs | null
) {
  return Boolean(
    refs?.positionPubkey &&
      !refs.signature &&
      isAmbiguousTransactionSubmissionError(error)
  )
}

function dispatchMarketDetailRefresh(marketIdOrSlug: string) {
  const detail: MarketDetailRefreshEventDetail = { marketIdOrSlug }

  window.dispatchEvent(
    new CustomEvent<MarketDetailRefreshEventDetail>(
      MARKET_DETAIL_REFRESH_EVENT,
      { detail }
    )
  )
}
