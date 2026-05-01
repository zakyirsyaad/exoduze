"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useWallet } from "@solana/react-hooks"
import { toast } from "sonner"

import { AgentCreateForm } from "@/components/agents/AgentCreateForm"
import { AgentSelector } from "@/components/agents/AgentSelector"
import { WalletConnectButton } from "@/components/SolanaConnectButton"
import { StrategyConfigurator } from "@/components/markets/StrategyConfigurator"
import { PredictionPreview } from "@/components/markets/PredictionPreview"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useApi } from "@/hooks/useApi"
import { useAuth } from "@/hooks/useAuth"
import { useStakeAndJoinBattle } from "@/hooks/useStakeAndJoinBattle"
import type {
  Agent,
  BattleEntry,
  BattlePool,
  BattleStrategyPreset,
  MarketDecisionSide,
  PageInfo,
} from "@/hooks/Type"
import { ApiError, apiFetch } from "@/lib/api"
import {
  buildEstimatedPayouts,
  createDefaultStrategyWeights,
  findExistingBattleEntry,
  sumWeights,
  type StrategyWeights,
} from "@/lib/battle-config"
import {
  buildStakeAndJoinBattleInstructions,
  getExoduzeProgramConfig,
  isValidSolanaPublicKey,
} from "@/lib/exoduze-program"
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
import { formatCurrency } from "@/components/layouts/markets/market-detail-helpers"

const TOKEN_DECIMALS = 6

type OwnedAgent = Pick<
  Agent,
  | "avatar_uri"
  | "base_personality"
  | "base_strategy"
  | "data_focus"
  | "description"
  | "id"
  | "name"
  | "risk_profile"
  | "slug"
  | "specialization"
  | "visibility"
> & {
  stats?: {
    accuracy_pct?: string | null
    wins?: number | null
  } | null
}

type OwnedAgentsResponse = {
  data:
    | OwnedAgent[]
    | {
        agents?: OwnedAgent[]
        items?: OwnedAgent[]
        page_info?: PageInfo
      }
  page_info?: PageInfo
}

type JoinMarketAgentResponse = {
  data: {
    already_joined?: boolean
    market_agent_id: string
    market: {
      id: string
      slug: string
      title: string
    }
    agent: {
      id: string
      slug: string
      name: string
    }
    battle_entry?: {
      id: string
      status: string
      strategy_preset: string
      stake_usdc: string
      prediction_hash: string
      prediction_json: Record<string, unknown>
    }
    commitment: {
      verification_status: string
      prompt_hash: string
      config_hash: string
      snapshot_hash: string
    }
    decision: {
      id: string
      sequence_no: number
      side: MarketDecisionSide
      confidence: number
      reason_summary: string
      key_signals: string[]
      risk_factors: string[]
      reason_hash: string
      decided_at: string
    }
  }
}

type StakePanelProps = {
  battleEntries: BattleEntry[]
  battlePool: BattlePool
  joinDeadlineAt?: string | null
  marketIdOrSlug: string
  marketPubkey?: string | null
  settlementAsset?: string
}

type StakeTransactionRefs = OnchainSyncRefs

export function StakePanel({
  battleEntries,
  battlePool,
  joinDeadlineAt = null,
  marketIdOrSlug,
  marketPubkey = null,
  settlementAsset = "USDC",
}: StakePanelProps) {
  const auth = useAuth()
  const router = useRouter()
  const wallet = useWallet()
  const stakeAndJoinBattle = useStakeAndJoinBattle()
  const {
    data: ownedAgentsData,
    get: getOwnedAgents,
    loading: loadingOwnedAgents,
    error: ownedAgentsError,
  } = useApi<OwnedAgentsResponse>()
  const [selectedAgentId, setSelectedAgentId] = React.useState("")
  const [activeTab, setActiveTab] = React.useState("my-agents")
  const [strategyPreset, setStrategyPreset] =
    React.useState<BattleStrategyPreset>("hybrid")
  const [weights, setWeights] = React.useState<StrategyWeights>(
    createDefaultStrategyWeights("hybrid")
  )
  const [optionalInsight, setOptionalInsight] = React.useState("")
  const [stakeAmount, setStakeAmount] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)
  const [submitError, setSubmitError] = React.useState<string | null>(null)
  const connectedWalletAddress =
    wallet.status === "connected"
      ? wallet.session.account.address.toString()
      : null
  const ownerWallet =
    connectedWalletAddress ?? auth.session?.wallet.wallet_address ?? null
  const ownedAgents = ownerWallet ? getOwnedAgentsPayload(ownedAgentsData) : []
  const effectiveSelectedAgentId = ownedAgents.some(
    (agent) => agent.id === selectedAgentId
  )
    ? selectedAgentId
    : (ownedAgents[0]?.id ?? "")
  const selectedAgent =
    ownedAgents.find((agent) => agent.id === effectiveSelectedAgentId) ?? null
  const existingEntry = effectiveSelectedAgentId
    ? findExistingBattleEntry(battleEntries, effectiveSelectedAgentId)
    : null
  const isLockedEntry = Boolean(
    existingEntry &&
    ["locked", "resolved", "claimed"].includes(existingEntry.status)
  )
  const isPendingExistingEntry =
    existingEntry?.status === "pending_onchain" ||
    existingEntry?.status === "submitted"
  const isBusy = submitting || stakeAndJoinBattle.loading
  const stakeReadinessMessage = getStakeReadinessError(marketPubkey)
  const payoutPreview = buildEstimatedPayouts(battlePool, stakeAmount)

  const refreshOwnedAgents = React.useCallback(() => {
    if (!ownerWallet) {
      return
    }

    void getOwnedAgents(`/v1/owners/${encodeURIComponent(ownerWallet)}/agents`)
  }, [getOwnedAgents, ownerWallet])

  React.useEffect(() => {
    refreshOwnedAgents()
  }, [refreshOwnedAgents])

  const ensureAuthSession = React.useCallback(async () => {
    if (
      auth.session &&
      (!connectedWalletAddress ||
        auth.session.wallet.wallet_address === connectedWalletAddress)
    ) {
      return auth.session
    }

    if (wallet.status !== "connected") {
      throw new Error("Connect and sign your wallet before joining a battle.")
    }

    return auth.loginWithWallet(wallet.session)
  }, [auth, connectedWalletAddress, wallet])

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitError(null)

    if (!selectedAgent) {
      const message = "Choose your agent before submitting."
      setSubmitError(message)
      toast.error(message)
      return
    }

    if (isLockedEntry) {
      return
    }

    if (sumWeights(weights) !== 100) {
      const message = "Signal weights must total 100."
      setSubmitError(message)
      toast.error(message)
      return
    }

    if (!isValidStakeAmount(stakeAmount)) {
      const message = "Enter a stake amount greater than zero."
      setSubmitError(message)
      toast.error(message)
      return
    }

    let stakeAmountBaseUnits: bigint

    try {
      stakeAmountBaseUnits = decimalToBaseUnits(stakeAmount, TOKEN_DECIMALS)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Enter a valid amount."
      setSubmitError(message)
      toast.error(message)
      return
    }

    if (stakeReadinessMessage) {
      setSubmitError(stakeReadinessMessage)
      toast.error(stakeReadinessMessage)
      return
    }

    const joinDeadlinePassedMessage =
      getJoinDeadlinePassedMessage(joinDeadlineAt)

    if (joinDeadlinePassedMessage) {
      setSubmitError(joinDeadlinePassedMessage)
      toast.error(joinDeadlinePassedMessage)
      return
    }

    let authSession

    try {
      authSession = await ensureAuthSession()
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Connect and sign your wallet before joining a battle."
      setSubmitError(message)
      toast.error(message)
      return
    }

    const toastId = toast.loading(
      isPendingExistingEntry
        ? "Resuming your pending submission..."
        : "Preparing locked prediction..."
    )
    let pendingOnchainCommitmentCreated = false
    let stakingTxSubmitted = false
    let response: JoinMarketAgentResponse | null = null

    const syncStakeConfirmation = async (refs: StakeTransactionRefs) => {
      await apiFetch(
        `/v1/markets/${encodeURIComponent(
          marketIdOrSlug
        )}/agents/${encodeURIComponent(response?.data.agent.id ?? "")}/stake`,
        {
          method: "POST",
          body: JSON.stringify({
            commit_included: true,
            market_agent_id: response?.data.market_agent_id,
            onchain_commitment_ref: requireTransactionRef(
              refs.agentCommitmentPubkey,
              "agent commitment"
            ),
            onchain_position_ref: requireTransactionRef(
              refs.positionPubkey,
              "position"
            ),
            stake_amount_base_units: stakeAmountBaseUnits.toString(),
            stake_usdc: stakeAmount.trim(),
            tx_sig: refs.signature,
            user_token_account: refs.userTokenAccount,
            vault_pubkey: refs.vaultPubkey,
          }),
        }
      )
    }

    try {
      setSubmitting(true)
      response = await apiFetch<JoinMarketAgentResponse>(
        `/v1/markets/${encodeURIComponent(
          marketIdOrSlug
        )}/agents/${encodeURIComponent(selectedAgent.id)}/join`,
        {
          method: "POST",
          body: JSON.stringify({
            strategy_preset: strategyPreset,
            technical_weight: weights.technicalWeight,
            news_weight: weights.newsWeight,
            sentiment_weight: weights.sentimentWeight,
            macro_weight: weights.macroWeight,
            onchain_weight: weights.onchainWeight,
            optional_insight: optionalInsight.trim() || null,
            stake_usdc: stakeAmount.trim(),
          }),
        }
      )
      pendingOnchainCommitmentCreated = true

      const stakeableDecisionSide = normalizeStakeableDecisionSide(
        response.data.decision.side
      )

      if (!stakeableDecisionSide) {
        throw new Error(
          "This prediction did not lock into a YES/NO side, so it cannot join the on-chain battle."
        )
      }

      if (getJoinDeadlinePassedMessage(joinDeadlineAt)) {
        throw new Error(
          "AI Agent entry is locked because the join deadline has passed."
        )
      }

      if (response.data.already_joined) {
        toast.loading("Recovering previous staking attempt...", {
          id: toastId,
        })

        const recoveryBundle = await buildStakeAndJoinBattleInstructions({
          agentId: response.data.agent.id,
          configHash: response.data.commitment.config_hash,
          decisionSide: stakeableDecisionSide,
          marketPubkey: marketPubkey ?? "",
          promptHash: response.data.commitment.prompt_hash,
          reasonHash: response.data.decision.reason_hash,
          settlementMint: getExoduzeProgramConfig().settlementMint,
          snapshotHash: response.data.commitment.snapshot_hash,
          stakeAmountBaseUnits,
          walletAddress: authSession.wallet.wallet_address,
        })

        try {
          await syncOnchainTransactionWithRetry({
            context: "battle-stake existing sync",
            onRetry: ({ attempt, totalAttempts }) => {
              toast.loading(
                `Recovering previous staking attempt... (${attempt}/${totalAttempts})`,
                {
                  description:
                    "Retrying backend sync for the last confirmed on-chain position.",
                  id: toastId,
                }
              )
            },
            refs: {
              agentCommitmentPubkey: recoveryBundle.agentCommitmentPubkey,
              positionPubkey: recoveryBundle.positionPubkey,
              userTokenAccount: recoveryBundle.userTokenAccount,
              vaultPubkey: recoveryBundle.vaultPubkey,
            },
            sync: syncStakeConfirmation,
          })

          finalizeSuccessfulJoin(
            toastId,
            marketIdOrSlug,
            router,
            `Recovered the previously submitted on-chain stake for ${response.data.agent.name}`
          )
          return
        } catch (error) {
          if (!isPendingOnchainSyncError(error)) {
            throw error
          }
        }
      }

      toast.loading("Confirm staking transaction in your wallet...", {
        id: toastId,
      })

      const transaction = await stakeAndJoinBattle.stakeAndJoinBattle({
        agentId: response.data.agent.id,
        configHash: response.data.commitment.config_hash,
        decisionSide: stakeableDecisionSide,
        marketPubkey: marketPubkey ?? "",
        promptHash: response.data.commitment.prompt_hash,
        reasonHash: response.data.decision.reason_hash,
        settlementMint: getExoduzeProgramConfig().settlementMint,
        snapshotHash: response.data.commitment.snapshot_hash,
        stakeAmountBaseUnits,
        walletAddress: authSession.wallet.wallet_address,
      })
      stakingTxSubmitted = true

      toast.loading("Syncing locked prediction...", { id: toastId })

      await syncOnchainTransactionWithRetry({
        context: "battle-stake sync",
        onRetry: ({ attempt, totalAttempts }) => {
          toast.loading(
            `Waiting for backend to observe staking tx... (${attempt}/${totalAttempts})`,
            {
              description: "Devnet/RPC propagation can take a few seconds.",
              id: toastId,
            }
          )
        },
        refs: transaction,
        sync: syncStakeConfirmation,
      })

      finalizeSuccessfulJoin(
        toastId,
        marketIdOrSlug,
        router,
        `${response.data.agent.name} joined this battle`
      )
    } catch (error) {
      const recoverableRefs = getTransactionRefs(error)

      if (
        response &&
        recoverableRefs &&
        canRecoverJoinBattleSync(error, recoverableRefs)
      ) {
        try {
          toast.loading("Recovering staking position...", {
            id: toastId,
          })
          await syncOnchainTransactionWithRetry({
            context: "battle-stake recovery",
            onRetry: ({ attempt, totalAttempts }) => {
              toast.loading(
                `Recovering staking position... (${attempt}/${totalAttempts})`,
                {
                  description:
                    "Retrying backend sync while the transaction propagates.",
                  id: toastId,
                }
              )
            },
            refs: recoverableRefs,
            sync: syncStakeConfirmation,
          })
          finalizeSuccessfulJoin(
            toastId,
            marketIdOrSlug,
            router,
            "Recovered confirmed on-chain position"
          )
          return
        } catch (recoveryError) {
          error = recoveryError
        }
      }

      const message = getJoinBattleErrorMessage(
        error,
        pendingOnchainCommitmentCreated,
        stakingTxSubmitted
      )
      setSubmitError(message)
      toast.error(message, { id: toastId })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card className="flex max-h-[85vh] flex-col overflow-hidden">
      <CardHeader className="shrink-0">
        <CardTitle>Join Battle Panel</CardTitle>
        <CardDescription>
          Choose your agent, configure battle strategy, and submit prediction
          and stake. Final payout depends on the winning pool at settlement.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col space-y-5 overflow-hidden">
        {!auth.isAuthenticated ? (
          <div className="rounded-2xl border border-dashed border-black/10 p-4 text-sm dark:border-white/10">
            <p className="font-medium">Connect Wallet</p>
            <p className="mt-1 text-neutral-500 dark:text-neutral-400">
              Connect and sign your wallet before creating agents or joining a
              battle.
            </p>
            <div className="mt-4">
              <WalletConnectButton />
            </div>
          </div>
        ) : null}

        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
          <TabsList variant="line" className="w-full shrink-0">
            <TabsTrigger value="my-agents">Choose your agent</TabsTrigger>
            <TabsTrigger value="create">Create agent</TabsTrigger>
          </TabsList>

          <TabsContent
            value="my-agents"
            className="flex min-h-0 flex-1 flex-col space-y-5 overflow-y-auto pt-2 pr-1"
          >
            <AgentSelector
              agents={ownedAgents}
              error={
                isOwnerNotFoundError(ownedAgentsError) ? null : ownedAgentsError
              }
              loading={loadingOwnedAgents || auth.loading}
              onSelect={setSelectedAgentId}
              selectedAgentId={effectiveSelectedAgentId}
            />
            <div className="space-y-5">
              {selectedAgent ? (
                <>
                  {existingEntry ? (
                    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm">
                      <p className="font-medium">
                        {isLockedEntry
                          ? "Prediction locked"
                          : "Stake pending for this agent"}
                      </p>
                      <p className="mt-1 text-neutral-600 dark:text-neutral-300">
                        {isLockedEntry
                          ? "Strategy cannot be edited after submission."
                          : "This prediction is prepared but not locked yet. Submit again to recover or finish the staking step."}
                      </p>
                    </div>
                  ) : null}

                  {existingEntry ? (
                    <PredictionPreview
                      entry={existingEntry}
                      settlementAsset={settlementAsset}
                    />
                  ) : null}

                  {!isLockedEntry ? (
                    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
                      <StrategyConfigurator
                        disabled={isBusy}
                        optionalInsight={optionalInsight}
                        preset={strategyPreset}
                        weights={weights}
                        onInsightChange={setOptionalInsight}
                        onPresetChange={(nextPreset, nextWeights) => {
                          setStrategyPreset(nextPreset)
                          setWeights(nextWeights)
                        }}
                        onWeightsChange={setWeights}
                      />

                      <form onSubmit={handleSubmit}>
                        <Card className="h-full">
                          <CardHeader>
                            <CardTitle>Submit prediction and stake</CardTitle>
                            <CardDescription>
                              Locked once submitted. Strategy cannot be edited
                              after submission.
                            </CardDescription>
                          </CardHeader>
                          <CardContent className="space-y-5">
                            <div className="space-y-2">
                              <label
                                htmlFor="stake-amount"
                                className="text-sm font-medium"
                              >
                                Stake amount
                              </label>
                              <Input
                                id="stake-amount"
                                type="number"
                                inputMode="decimal"
                                min="0"
                                step="any"
                                value={stakeAmount}
                                onChange={(event) => {
                                  setStakeAmount(event.target.value)
                                  setSubmitError(null)
                                }}
                                placeholder={`0.00 ${settlementAsset}`}
                                disabled={isBusy}
                                required
                              />
                            </div>

                            <div className="rounded-2xl border border-black/10 bg-black/[0.02] p-4 text-sm dark:border-white/10 dark:bg-white/5">
                              <p className="font-medium">
                                Estimated payout preview
                              </p>
                              <div className="mt-3 grid gap-3">
                                {payoutPreview.length ? (
                                  payoutPreview.map((item) => (
                                    <div
                                      key={item.direction}
                                      className="flex items-center justify-between gap-3"
                                    >
                                      <span>
                                        {item.direction.toUpperCase()} pool
                                      </span>
                                      <span className="font-medium">
                                        {formatCurrency(
                                          String(item.grossEstimate),
                                          settlementAsset
                                        )}
                                      </span>
                                    </div>
                                  ))
                                ) : (
                                  <p className="text-neutral-500 dark:text-neutral-400">
                                    Enter a stake amount to preview pool-based
                                    estimates.
                                  </p>
                                )}
                              </div>
                            </div>

                            {stakeReadinessMessage ? (
                              <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                                {stakeReadinessMessage}
                              </p>
                            ) : null}

                            {submitError ? (
                              <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                                {submitError}
                              </p>
                            ) : null}

                            <Button
                              type="submit"
                              className="w-full"
                              disabled={
                                isBusy || Boolean(stakeReadinessMessage)
                              }
                            >
                              {isBusy
                                ? "Submitting..."
                                : isPendingExistingEntry
                                  ? "Resume Stake"
                                  : "Submit Prediction & Stake"}
                            </Button>
                          </CardContent>
                        </Card>
                      </form>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          </TabsContent>

          <TabsContent
            value="create"
            className="min-h-0 flex-1 overflow-y-auto pt-2 pr-1"
          >
            <AgentCreateForm
              onCreated={() => {
                setActiveTab("my-agents")
                refreshOwnedAgents()
              }}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}

function getOwnedAgentsPayload(response: OwnedAgentsResponse | null) {
  if (!response) {
    return []
  }

  if (Array.isArray(response.data)) {
    return response.data
  }

  return response.data.agents ?? response.data.items ?? []
}

function isOwnerNotFoundError(error: string | null) {
  return Boolean(
    error?.toLowerCase().includes("owner") &&
    error.toLowerCase().includes("not found")
  )
}

function getStakeReadinessError(marketPubkey: string | null) {
  const config = getExoduzeProgramConfig()

  if (!marketPubkey) {
    return "Staking is not active for this market yet. The market needs to be published on-chain first."
  }

  if (!isValidSolanaPublicKey(marketPubkey)) {
    return "Staking is not active for this market yet. The market needs a valid on-chain pubkey first."
  }

  if (!config.programId) {
    return "Staking is required before joining, but the on-chain program is not configured yet."
  }

  if (!isValidSolanaPublicKey(config.programId)) {
    return "Staking is required before joining, but the on-chain program id is invalid."
  }

  if (!config.settlementMint) {
    return "Staking is required before joining, but the settlement mint is not configured yet."
  }

  if (!isValidSolanaPublicKey(config.settlementMint)) {
    return "Staking is required before joining, but the settlement mint is invalid."
  }

  if (!config.hasIdl) {
    return "Staking is required before joining, but the on-chain transaction is not wired yet."
  }

  return null
}

function isValidStakeAmount(value: string) {
  const numericValue = Number(value)

  return Number.isFinite(numericValue) && numericValue > 0
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

function normalizeStakeableDecisionSide(
  side: MarketDecisionSide
): "YES" | "NO" | null {
  return side === "YES" || side === "NO" ? side : null
}

function getJoinDeadlinePassedMessage(joinDeadlineAt: string | null) {
  if (!joinDeadlineAt) {
    return null
  }

  const joinDeadlineAtMs = Date.parse(joinDeadlineAt)

  if (Number.isNaN(joinDeadlineAtMs) || Date.now() < joinDeadlineAtMs) {
    return null
  }

  return "AI Agent entry is locked because the join deadline has passed."
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

function canRecoverJoinBattleSync(
  error: unknown,
  refs: StakeTransactionRefs | null
) {
  return Boolean(
    refs?.agentCommitmentPubkey &&
    refs.positionPubkey &&
    !refs.signature &&
    isAmbiguousTransactionSubmissionError(error)
  )
}

function finalizeSuccessfulJoin(
  toastId: string | number,
  marketIdOrSlug: string,
  router: ReturnType<typeof useRouter>,
  description: string
) {
  toast.success("Prediction locked", {
    description,
    id: toastId,
  })
  dispatchMarketDetailRefresh(marketIdOrSlug)
  router.refresh()
}

function getJoinBattleErrorMessage(
  error: unknown,
  pendingOnchainCommitmentCreated = false,
  stakingTxSubmitted = false
) {
  const prefix = pendingOnchainCommitmentCreated
    ? stakingTxSubmitted
      ? "Staking tx was submitted, but backend sync failed: "
      : "Prediction was prepared, but staking failed: "
    : ""

  if (error instanceof ApiError) {
    if (error.status === 401) {
      return `${prefix}Connect and sign your wallet before joining a battle.`
    }

    if (error.status === 403) {
      return `${prefix}This wallet cannot use the selected AI agent for this battle.`
    }

    if (error.status === 404) {
      return `${prefix}This market or AI agent could not be found.`
    }

    if (error.status === 409) {
      return `${prefix}This battle state changed before the stake completed. Refresh the market and try again.`
    }

    return `${prefix}The battle submission could not be accepted right now. Review the form and try again.`
  }

  const transactionRefs = getTransactionRefs(error)
  const diagnosticRefs = formatOnchainSyncRefs(transactionRefs)

  if (isPendingOnchainSyncError(error)) {
    const diagnosticSuffix = diagnosticRefs ? ` (${diagnosticRefs})` : ""

    return `${prefix}Backend has not observed the staking position yet. If your wallet shows the transaction as confirmed, wait a few seconds and refresh the market.${diagnosticSuffix}`
  }

  if (
    pendingOnchainCommitmentCreated &&
    !stakingTxSubmitted &&
    transactionRefs &&
    !transactionRefs.signature &&
    isAmbiguousTransactionSubmissionError(error)
  ) {
    const diagnosticSuffix = diagnosticRefs ? ` (${diagnosticRefs})` : ""

    return `${prefix}The wallet did not return a staking transaction signature yet. Check your wallet activity, SOL fee balance, and ${getExoduzeProgramConfig().settlementMint ? "settlement token balance" : "token balance"}, then try again.${diagnosticSuffix}`
  }

  const message =
    error instanceof Error ? error.message : "Unable to join battle."

  return diagnosticRefs
    ? `${prefix}${message} (${diagnosticRefs})`
    : `${prefix}${message}`
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
