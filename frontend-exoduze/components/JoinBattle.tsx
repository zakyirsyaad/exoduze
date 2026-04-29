"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useWallet } from "@solana/react-hooks"
import { toast } from "sonner"

import { CreateAgentForm } from "@/components/agents/CreateAgentForm"
import { useApi } from "@/hooks/useApi"
import { useAuth } from "@/hooks/useAuth"
import { useMediaQuery } from "@/hooks/use-media-query"
import { useStakeAndJoinBattle } from "@/hooks/useStakeAndJoinBattle"
import type { Agent, MarketDecisionSide, PageInfo } from "@/hooks/Type"
import { ApiError, apiFetch } from "@/lib/api"
import {
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
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs"
import { RainbowButton } from "./ui/rainbow-button"
import { Separator } from "./ui/separator"

type BattleStep = "select-agent" | "configure-battle"

const TOKEN_DECIMALS = 6

type OwnedAgent = Pick<Agent, "id" | "slug" | "name" | "description"> & {
  status?: Agent["status"]
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

type JoinBattleProps = {
  marketIdOrSlug: string
  marketPubkey?: string | null
  joinDeadlineAt?: string | null
  onJoined?: (response: JoinMarketAgentResponse) => void
  settlementAsset?: string
}

type StakeTransactionRefs = OnchainSyncRefs

export function JoinBattle({
  marketIdOrSlug,
  marketPubkey = null,
  joinDeadlineAt = null,
  onJoined,
  settlementAsset = "USDC",
}: JoinBattleProps) {
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
  const [open, setOpen] = React.useState(false)
  const [selectedAgent, setSelectedAgent] = React.useState<string>("")
  const [battleStep, setBattleStep] = React.useState<BattleStep>("select-agent")
  const [prompt, setPrompt] = React.useState("")
  const [stakeAmount, setStakeAmount] = React.useState("")
  const [joiningBattle, setJoiningBattle] = React.useState(false)
  const [joinBattleError, setJoinBattleError] = React.useState<string | null>(
    null
  )
  const isJoiningBattle = joiningBattle || stakeAndJoinBattle.loading
  const isDesktop = useMediaQuery("(min-width: 768px)")
  const connectedWalletAddress =
    wallet.status === "connected"
      ? wallet.session.account.address.toString()
      : null
  const ownerWallet = connectedWalletAddress ?? auth.session?.wallet.wallet_address ?? null
  const ownedAgents = ownerWallet ? getOwnedAgentsPayload(ownedAgentsData) : []
  const stakeReadinessMessage = getStakeReadinessError(marketPubkey)
  const effectiveSelectedAgent = ownedAgents.some(
    (agent) => agent.id === selectedAgent
  )
    ? selectedAgent
    : (ownedAgents[0]?.id ?? "")

  const selectedAgentDetails =
    ownedAgents.find((agent) => agent.id === effectiveSelectedAgent) ??
    ownedAgents[0] ??
    null

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

  const resetJoinFlow = () => {
    setSelectedAgent("")
    setBattleStep("select-agent")
    setPrompt("")
    setStakeAmount("")
    setJoinBattleError(null)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)

    if (!nextOpen) {
      resetJoinFlow()
      stakeAndJoinBattle.reset()
    }
  }

  const handleSubmitBattle = async (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault()
    setJoinBattleError(null)

    if (!effectiveSelectedAgent) {
      const message = "Choose an AI agent before joining this battle."
      setJoinBattleError(message)
      toast.error(message)
      return
    }

    const userPrompt = prompt.trim()

    if (!userPrompt) {
      const message = "Add a battle prompt before joining."
      setJoinBattleError(message)
      toast.error(message)
      return
    }

    if (!isValidStakeAmount(stakeAmount)) {
      const message = "Enter a stake amount greater than zero."
      setJoinBattleError(message)
      toast.error(message)
      return
    }

    let stakeAmountBaseUnits: bigint

    try {
      stakeAmountBaseUnits = decimalToBaseUnits(stakeAmount, TOKEN_DECIMALS)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Enter a valid stake amount."
      setJoinBattleError(message)
      toast.error(message)
      return
    }

    if (stakeReadinessMessage) {
      setJoinBattleError(stakeReadinessMessage)
      toast.error(stakeReadinessMessage)
      return
    }

    const joinDeadlinePassedMessage = getJoinDeadlinePassedMessage(
      joinDeadlineAt
    )

    if (joinDeadlinePassedMessage) {
      setJoinBattleError(joinDeadlinePassedMessage)
      toast.error(joinDeadlinePassedMessage)
      return
    }

    let authSession

    try {
      authSession = await ensureAuthSession()
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Connect and sign your wallet before joining a battle."
      setJoinBattleError(message)
      toast.error(message)
      return
    }

    const toastId = toast.loading("Preparing AI decision...")
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
      setJoiningBattle(true)
      response = await apiFetch<JoinMarketAgentResponse>(
        `/v1/markets/${encodeURIComponent(
          marketIdOrSlug
        )}/agents/${encodeURIComponent(effectiveSelectedAgent)}/join`,
        {
          method: "POST",
          body: JSON.stringify({ user_prompt: userPrompt }),
        }
      )
      pendingOnchainCommitmentCreated = true

      const stakeableDecisionSide = normalizeStakeableDecisionSide(
        response.data.decision.side
      )

      if (!stakeableDecisionSide) {
        throw new Error(
          "This AI agent abstained from taking a YES/NO side, so it cannot join this on-chain market."
        )
      }

      const joinDeadlinePassedAfterDecisionMessage = getJoinDeadlinePassedMessage(
        joinDeadlineAt
      )

      if (joinDeadlinePassedAfterDecisionMessage) {
        throw new Error(joinDeadlinePassedAfterDecisionMessage)
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

      toast.loading("Syncing staking position...", {
        id: toastId,
      })

      await syncOnchainTransactionWithRetry({
        context: "join-battle stake sync",
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

      toast.success(`${response.data.agent.name} joined this battle`, {
        description: `Staking tx ${truncateSignature(transaction.signature)}`,
        id: toastId,
      })
      onJoined?.(response)
      dispatchMarketDetailRefresh(marketIdOrSlug)
      router.refresh()
      setOpen(false)
      resetJoinFlow()
    } catch (err) {
      const recoverableRefs = getTransactionRefs(err)
      if (
        response &&
        recoverableRefs &&
        canRecoverJoinBattleSync(err, recoverableRefs)
      ) {
        try {
          const refs = recoverableRefs
          toast.loading("Recovering staking position...", {
            id: toastId,
          })
          await syncOnchainTransactionWithRetry({
            context: "join-battle stake recovery",
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
            refs,
            sync: syncStakeConfirmation,
          })
          toast.success(`${response.data.agent.name} joined this battle`, {
            description: "Recovered confirmed on-chain position",
            id: toastId,
          })
          onJoined?.(response)
          dispatchMarketDetailRefresh(marketIdOrSlug)
          router.refresh()
          setOpen(false)
          resetJoinFlow()
          return
        } catch (recoveryError) {
          err = recoveryError
        }
      }

      const message = getJoinBattleErrorMessage(
        err,
        pendingOnchainCommitmentCreated,
        stakingTxSubmitted
      )
      setJoinBattleError(message)
      toast.error(message, { id: toastId })
    } finally {
      setJoiningBattle(false)
    }
  }

  const content = (
    <JoinBattlePanel
      selectedAgent={effectiveSelectedAgent}
      selectedAgentDetails={selectedAgentDetails}
      ownedAgents={ownedAgents}
      battleStep={battleStep}
      prompt={prompt}
      settlementAsset={settlementAsset}
      stakeReadinessMessage={stakeReadinessMessage}
      stakeAmount={stakeAmount}
      joiningBattle={isJoiningBattle}
      joinBattleError={joinBattleError}
      loadingOwnedAgents={loadingOwnedAgents || auth.loading}
      ownedAgentsError={ownedAgentsError}
      isAuthenticated={auth.isAuthenticated}
      onAgentChange={setSelectedAgent}
      onContinueToSetup={() => setBattleStep("configure-battle")}
      onBackToAgentList={() => setBattleStep("select-agent")}
      onPromptChange={(event) => setPrompt(event.target.value)}
      onStakeChange={(event) => setStakeAmount(event.target.value)}
      onSubmitBattle={handleSubmitBattle}
      onAgentCreated={refreshOwnedAgents}
    />
  )

  if (isDesktop) {
    return (
      <section>
        <Dialog open={open} onOpenChange={handleOpenChange}>
          <DialogTrigger asChild>
            <RainbowButton variant="outline" className="w-full">
              Join Battle Competitions
            </RainbowButton>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader className="sr-only">
              <DialogTitle>Join Battle Competitions</DialogTitle>
              <DialogDescription>
                Create an AI agent or use one of your agents to join the current
                battle.
              </DialogDescription>
            </DialogHeader>
            {content}
          </DialogContent>
        </Dialog>
      </section>
    )
  }

  return (
    <Drawer open={open} onOpenChange={handleOpenChange}>
      <DrawerTrigger asChild>
        <RainbowButton variant="outline" className="w-full">
          Join Battle Competitions
        </RainbowButton>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader className="sr-only">
          <DrawerTitle>Join Battle Competitions</DrawerTitle>
          <DrawerDescription>
            Create an AI agent or use one of your agents to join the current
            battle.
          </DrawerDescription>
        </DrawerHeader>
        <div className="overflow-y-auto px-4 pb-4">{content}</div>
      </DrawerContent>
    </Drawer>
  )
}

type JoinBattlePanelProps = {
  battleStep: BattleStep
  isAuthenticated: boolean
  joinBattleError: string | null
  joiningBattle: boolean
  loadingOwnedAgents: boolean
  ownedAgents: OwnedAgent[]
  ownedAgentsError: string | null
  prompt: string
  selectedAgent: string
  selectedAgentDetails: OwnedAgent | null
  settlementAsset: string
  stakeReadinessMessage: string | null
  stakeAmount: string
  onAgentChange: (value: string) => void
  onAgentCreated: () => void
  onBackToAgentList: () => void
  onContinueToSetup: () => void
  onPromptChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void
  onStakeChange: (event: React.ChangeEvent<HTMLInputElement>) => void
  onSubmitBattle: (event: React.FormEvent<HTMLFormElement>) => void
}

function JoinBattlePanel({
  battleStep,
  isAuthenticated,
  joinBattleError,
  joiningBattle,
  loadingOwnedAgents,
  ownedAgents,
  ownedAgentsError,
  prompt,
  selectedAgent,
  selectedAgentDetails,
  settlementAsset,
  stakeReadinessMessage,
  stakeAmount,
  onAgentChange,
  onAgentCreated,
  onBackToAgentList,
  onContinueToSetup,
  onPromptChange,
  onStakeChange,
  onSubmitBattle,
}: JoinBattlePanelProps) {
  const shouldShowOwnedAgentsError =
    Boolean(ownedAgentsError) &&
    !ownedAgents.length &&
    !isOwnerNotFoundError(ownedAgentsError)

  return (
    <Tabs defaultValue="my-agents" className="gap-4">
      <TabsList variant="line" className="w-full">
        <TabsTrigger value="my-agents">My AI Agents</TabsTrigger>
        <TabsTrigger value="create">Create AI Agent</TabsTrigger>
      </TabsList>

      <TabsContent value="my-agents" className="space-y-4 pt-2">
        {battleStep === "select-agent" ? (
          <div className="space-y-4">
            <div>
              <h3 className="font-medium">Choose an agent to join battle</h3>
              <p className="text-sm text-muted-foreground">
                Pick one of your AI agents, then continue to set the battle
                prompt and stake.
              </p>
            </div>

            <RadioGroup
              value={selectedAgent}
              onValueChange={onAgentChange}
              className="max-w-none"
            >
              {ownedAgents.map((agent) => (
                <FieldLabel key={agent.id} htmlFor={`owned-agent-${agent.id}`}>
                  <Field orientation="horizontal">
                    <FieldContent>
                      <FieldTitle>{agent.name}</FieldTitle>
                      <FieldDescription className="line-clamp-3">
                        {agent.description || `@${agent.slug}`}
                      </FieldDescription>
                    </FieldContent>
                    <RadioGroupItem
                      value={agent.id}
                      id={`owned-agent-${agent.id}`}
                    />
                  </Field>
                </FieldLabel>
              ))}
            </RadioGroup>

            {!isAuthenticated ? (
              <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                Connect and sign your wallet first to load your AI agents.
              </p>
            ) : null}

            {loadingOwnedAgents ? (
              <p className="text-sm text-muted-foreground">
                Loading your AI agents...
              </p>
            ) : null}

            {shouldShowOwnedAgentsError ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                We could not load your AI agents right now. Please try again in
                a moment.
              </p>
            ) : null}

            {isAuthenticated &&
            !loadingOwnedAgents &&
            !ownedAgents.length &&
            !shouldShowOwnedAgentsError ? (
              <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                You do not have an AI agent yet. Use the Create AI Agent tab to
                create one first.
              </p>
            ) : null}

            <Button
              type="button"
              className="w-full"
              onClick={onContinueToSetup}
              disabled={!selectedAgent || loadingOwnedAgents || joiningBattle}
            >
              Continue to Prompt & Stake
            </Button>
          </div>
        ) : (
          <form className="grid items-start gap-4" onSubmit={onSubmitBattle}>
            <div>
              <h3 className="font-medium">Configure prompt and stake</h3>
              <p className="text-sm text-muted-foreground">
                {selectedAgentDetails?.name} will enter this battle using the
                prompt and stake below.
              </p>
            </div>
            <Separator />
            <div>
              <p className="font-medium">{selectedAgentDetails?.name}</p>
              <p className="line-clamp-3 text-sm text-muted-foreground">
                {selectedAgentDetails?.description}
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="battle-prompt">Battle Prompt</Label>
              <textarea
                id="battle-prompt"
                value={prompt}
                onChange={onPromptChange}
                placeholder="Describe the strategy, angle, or risk profile for this round."
                className={cn(
                  "min-h-28 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none",
                  "placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                )}
                required
                disabled={joiningBattle}
              />
              <p className="text-sm text-muted-foreground">
                Use the prompt to define how this agent should approach the
                current market battle.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="battle-stake">Stake Amount</Label>
              <Input
                id="battle-stake"
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={stakeAmount}
                onChange={onStakeChange}
                placeholder={`0.00 ${settlementAsset}`}
                required
                disabled={joiningBattle}
              />
              <p className="text-sm text-muted-foreground">
                Settlement asset:{" "}
                <span className="font-medium text-foreground">
                  {settlementAsset}
                </span>
              </p>
            </div>

            {stakeReadinessMessage ? (
              <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                {stakeReadinessMessage}
              </p>
            ) : null}

            {joinBattleError ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {joinBattleError}
              </p>
            ) : null}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <Button
                type="button"
                variant="outline"
                onClick={onBackToAgentList}
                disabled={joiningBattle}
              >
                Back to Agents
              </Button>
              <Button
                type="submit"
                disabled={joiningBattle || Boolean(stakeReadinessMessage)}
              >
                {joiningBattle ? "Joining..." : "Stake & Join Battle"}
              </Button>
            </div>
          </form>
        )}
      </TabsContent>

      <TabsContent value="create" className="space-y-4 pt-2">
        <div>
          <h3 className="font-medium">Create AI Agent</h3>
          <p className="text-sm text-muted-foreground">
            Set up a new AI agent, then come back here to join a battle with it.
          </p>
        </div>
        <CreateAgentForm onCreated={onAgentCreated} />
      </TabsContent>
    </Tabs>
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

function getJoinBattleErrorMessage(
  error: unknown,
  pendingOnchainCommitmentCreated = false,
  stakingTxSubmitted = false
) {
  const prefix = pendingOnchainCommitmentCreated
    ? stakingTxSubmitted
      ? "Staking tx was submitted, but backend sync failed: "
      : "AI decision was prepared, but staking failed: "
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

function truncateSignature(signature: string) {
  return `${signature.slice(0, 6)}...${signature.slice(-6)}`
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

function dispatchMarketDetailRefresh(marketIdOrSlug: string) {
  const detail: MarketDetailRefreshEventDetail = { marketIdOrSlug }

  window.dispatchEvent(
    new CustomEvent<MarketDetailRefreshEventDetail>(
      MARKET_DETAIL_REFRESH_EVENT,
      { detail }
    )
  )
}
