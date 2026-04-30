"use client"

import { useCallback, useMemo, useState } from "react"
import {
  useBalance,
  useSplToken,
  useWallet,
  useWalletConnection,
} from "@solana/react-hooks"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  LogoutSquare01Icon,
  Wallet01Icon,
  WalletDone01Icon,
} from "@hugeicons/core-free-icons"

import { Button } from "./ui/button"
import { useAuth } from "@/hooks/useAuth"
import { ApiError } from "@/lib/api"
import { cn } from "@/lib/utils"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"

const CONNECTORS = [
  { id: "wallet-standard:phantom", label: "Phantom" },
  { id: "wallet-standard:solflare", label: "Solflare" },
  { id: "wallet-standard:backpack", label: "Backpack" },
  { id: "phantom:legacy", label: "Phantom" },
] as const

const CONNECTOR_LABELS = new Map<string, string>(
  CONNECTORS.map((connector) => [connector.id, connector.label])
)

const USDC_MINT =
  process.env.NEXT_PUBLIC_SETTLEMENT_MINT ??
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"

const WALLET_AUTH_TOAST_ID = "wallet-auth-flow"

type WalletFlowStep = "idle" | "connecting" | "signing" | "disconnecting"
type StepState = "idle" | "active" | "done"

type WalletConnector = ReturnType<
  typeof useWalletConnection
>["connectors"][number]

export function WalletConnectButton() {
  const wallet = useWallet()
  const walletConnection = useWalletConnection()
  const auth = useAuth()

  const [error, setError] = useState<string | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [flowStep, setFlowStep] = useState<WalletFlowStep>("idle")
  const [activeConnectorId, setActiveConnectorId] = useState<string | null>(
    null
  )

  const isConnected = wallet.status === "connected"
  const address = isConnected ? wallet.session.account.address.toString() : null
  const authenticatedAddress = auth.session?.wallet.wallet_address ?? null

  const isConnectedAuthenticatedWallet =
    isConnected && Boolean(address) && address === authenticatedAddress

  const needsSignature = isConnected && !isConnectedAuthenticatedWallet
  const displayAddress = address ?? authenticatedAddress

  const balance = useBalance(address ?? undefined, { watch: false })

  const { balance: usdcBalance } = useSplToken(USDC_MINT, {
    owner: address ?? undefined,
  })

  const isFlowActive = flowStep !== "idle"

  const isBusy = walletConnection.connecting || auth.loading || isFlowActive

  const availableConnectors = useMemo(
    () => getAvailableConnectors(walletConnection.connectors),
    [walletConnection.connectors]
  )

  const triggerLabel = useMemo(
    () => getTriggerLabel(flowStep, auth.loading),
    [flowStep, auth.loading]
  )

  const connectStepState: StepState = useMemo(() => {
    if (isConnected) return "done"
    if (flowStep === "connecting" || walletConnection.connecting)
      return "active"
    return "idle"
  }, [isConnected, flowStep, walletConnection.connecting])

  const signStepState: StepState = useMemo(() => {
    if (auth.isAuthenticated) return "done"
    if (flowStep === "signing" || (auth.loading && isConnected)) return "active"
    return "idle"
  }, [auth.isAuthenticated, auth.loading, flowStep, isConnected])

  const resetUnauthenticatedWallet = useCallback(async () => {
    try {
      await walletConnection.disconnect()
    } catch {
      /**
       * Do nothing.
       * We keep the original connect/auth error visible to the user.
       */
    }
  }, [walletConnection])

  const handleConnect = useCallback(
    async (connectorId: string) => {
      setError(null)
      setActiveConnectorId(connectorId)
      setFlowStep("connecting")

      let connectedSession: Awaited<
        ReturnType<typeof walletConnection.connect>
      > | null = null

      try {
        toast.loading("Open your wallet and approve the connection.", {
          id: WALLET_AUTH_TOAST_ID,
        })

        connectedSession = await walletConnection.connect(connectorId, {
          allowInteractiveFallback: true,
          autoConnect: false,
        })

        setFlowStep("signing")

        toast.loading("Approve the sign-in message in your wallet.", {
          id: WALLET_AUTH_TOAST_ID,
        })

        await auth.loginWithWallet(connectedSession)

        setIsDialogOpen(false)

        toast.success("Wallet connected and signed.", {
          id: WALLET_AUTH_TOAST_ID,
        })
      } catch (err) {
        /**
         * If the wallet connection failed before a session was created,
         * clean up the wallet connector state.
         *
         * If signing/auth failed after wallet connection,
         * keep the wallet connected so the user can retry signing.
         */
        if (!connectedSession) {
          await resetUnauthenticatedWallet()
        }

        const message = getWalletErrorMessage(
          err,
          connectedSession ? "auth" : "connect"
        )

        setError(message)

        toast.error(message, {
          id: WALLET_AUTH_TOAST_ID,
        })
      } finally {
        setFlowStep("idle")
        setActiveConnectorId(null)
      }
    },
    [auth, resetUnauthenticatedWallet, walletConnection]
  )

  const handleSignIn = useCallback(async () => {
    setError(null)

    if (wallet.status !== "connected") {
      const message = "Connect a wallet before signing in."
      setError(message)
      toast.error(message)
      return
    }

    try {
      setFlowStep("signing")

      toast.loading("Approve the sign-in message in your wallet.", {
        id: WALLET_AUTH_TOAST_ID,
      })

      await auth.loginWithWallet(wallet.session)

      setIsDialogOpen(false)

      toast.success("Wallet signed in.", {
        id: WALLET_AUTH_TOAST_ID,
      })
    } catch (err) {
      const message = getWalletErrorMessage(err, "auth")

      setError(message)

      toast.error(message, {
        id: WALLET_AUTH_TOAST_ID,
      })
    } finally {
      setFlowStep("idle")
    }
  }, [auth, wallet])

  const handleDisconnect = useCallback(async () => {
    setError(null)
    setFlowStep("disconnecting")

    try {
      await auth.logout()
      await walletConnection.disconnect()

      toast.success("Wallet disconnected.")
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to disconnect wallet."

      setError(message)
      toast.error(message)
    } finally {
      setFlowStep("idle")
    }
  }, [auth, walletConnection])

  if (displayAddress) {
    return (
      <ConnectedWalletView
        address={displayAddress}
        authLoading={auth.loading}
        isAdmin={auth.isAdmin}
        isAuthenticated={auth.isAuthenticated}
        isBusy={isBusy}
        isConnected={isConnected}
        isConnectedAuthenticatedWallet={isConnectedAuthenticatedWallet}
        needsSignature={needsSignature}
        solBalance={balance.lamports}
        usdcBalance={usdcBalance?.uiAmount}
        flowStep={flowStep}
        onDisconnect={() => void handleDisconnect()}
        onSignIn={() => void handleSignIn()}
      />
    )
  }

  return (
    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="lg" disabled={isBusy}>
          <HugeiconsIcon icon={WalletDone01Icon} />
          {triggerLabel}
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect Solana wallet</DialogTitle>
          <DialogDescription>
            Choose a wallet, approve the connection, then sign the auth message.
            The signature only proves wallet ownership.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <AuthStep
              number={1}
              state={connectStepState}
              title="Connect"
              description="Open wallet"
            />
            <AuthStep
              number={2}
              state={signStepState}
              title="Sign"
              description="Verify ownership"
            />
          </div>

          {error ? (
            <div
              role="alert"
              className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {error}
            </div>
          ) : null}

          {isConnected && address ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
              <div>
                <p className="font-medium">Wallet connected</p>
                <p className="font-mono text-[0.625rem] text-muted-foreground">
                  {truncateAddress(address)}
                </p>
              </div>

              {needsSignature ? (
                <Button
                  type="button"
                  disabled={auth.loading || flowStep === "signing"}
                  onClick={() => void handleSignIn()}
                >
                  {auth.loading || flowStep === "signing"
                    ? "Waiting..."
                    : "Sign message"}
                </Button>
              ) : (
                <Badge variant="secondary" className="rounded">
                  Signed
                </Badge>
              )}
            </div>
          ) : null}

          <div className="grid gap-2">
            {!walletConnection.isReady ? (
              <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
                Detecting Solana wallets...
              </p>
            ) : availableConnectors.length ? (
              availableConnectors.map((connector) => (
                <WalletOptionButton
                  key={connector.id}
                  connector={connector}
                  disabled={isBusy}
                  isActive={activeConnectorId === connector.id && isBusy}
                  flowStep={flowStep}
                  onConnect={() => void handleConnect(connector.id)}
                />
              ))
            ) : (
              <div className="rounded-md border border-dashed px-3 py-2">
                <p className="font-medium">No Solana wallet detected</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Install Phantom, Solflare, or Backpack, then refresh this
                  page.
                </p>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ConnectedWalletView({
  address,
  authLoading,
  flowStep,
  isAdmin,
  isAuthenticated,
  isBusy,
  isConnected,
  isConnectedAuthenticatedWallet,
  needsSignature,
  solBalance,
  usdcBalance,
  onDisconnect,
  onSignIn,
}: {
  address: string
  authLoading: boolean
  flowStep: WalletFlowStep
  isAdmin: boolean
  isAuthenticated: boolean
  isBusy: boolean
  isConnected: boolean
  isConnectedAuthenticatedWallet: boolean
  needsSignature: boolean
  solBalance: bigint | null | undefined
  usdcBalance: number | string | null | undefined
  onDisconnect: () => void
  onSignIn: () => void
}) {
  return (
    <section className="flex items-center gap-3">
      <div>
        <div className="flex items-center gap-1">
          <p className="font-medium">{truncateAddress(address)}</p>

          {isAdmin ? (
            <Badge variant="secondary" className="rounded">
              Admin
            </Badge>
          ) : null}
        </div>

        {isConnectedAuthenticatedWallet ? (
          <div className="grid grid-cols-2">
            <p className="font-bold">
              {formatUsdcBalance(usdcBalance)}{" "}
              <span className="text-sm font-normal">USDC</span>
            </p>
            <p className="font-bold">
              {formatSolBalance(solBalance)}{" "}
              <span className="text-sm font-normal">SOL</span>
            </p>
          </div>
        ) : null}
      </div>
      <div>
        {needsSignature ? (
          <Button
            type="button"
            variant="default"
            disabled={authLoading || flowStep === "signing"}
            onClick={onSignIn}
            size={"icon-lg"}
          >
            {authLoading || flowStep === "signing"
              ? "Waiting signature..."
              : "Sign message"}
          </Button>
        ) : null}

        <Button
          type="button"
          variant="secondary"
          size="icon"
          disabled={isBusy}
          onClick={onDisconnect}
          aria-label="Disconnect wallet"
          title="Disconnect wallet"
        >
          <HugeiconsIcon icon={LogoutSquare01Icon} />
        </Button>
      </div>
    </section>
  )
}

function WalletOptionButton({
  connector,
  disabled,
  flowStep,
  isActive,
  onConnect,
}: {
  connector: WalletConnector
  disabled: boolean
  flowStep: WalletFlowStep
  isActive: boolean
  onConnect: () => void
}) {
  return (
    <Button
      type="button"
      disabled={disabled}
      onClick={onConnect}
      variant="outline"
      size="lg"
      className="h-auto justify-between px-3 py-3 hover:bg-secondary/10"
    >
      <span className="flex items-center gap-2">
        <HugeiconsIcon icon={Wallet01Icon} />
        <span className="grid text-left leading-tight">
          <span>{getConnectorLabel(connector.id, connector.name)}</span>
          <span className="text-[0.625rem] text-muted-foreground">
            Detected wallet
          </span>
        </span>
      </span>

      <span className="text-[0.625rem] text-muted-foreground">
        {isActive ? getActiveConnectorLabel(flowStep) : "Connect"}
      </span>
    </Button>
  )
}

function AuthStep({
  description,
  number,
  state,
  title,
}: {
  description: string
  number: number
  state: StepState
  title: string
}) {
  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2",
        state === "done"
          ? "border-emerald-500/20 bg-emerald-500/10"
          : state === "active"
            ? "border-primary/30 bg-primary/10"
            : "border-border bg-muted/20"
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "grid size-5 place-items-center rounded-full text-[0.625rem] font-semibold",
            state === "done"
              ? "bg-emerald-600 text-white"
              : state === "active"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground"
          )}
        >
          {state === "done" ? "OK" : number}
        </span>

        <div className="grid leading-tight">
          <span className="font-medium">{title}</span>
          <span className="text-[0.625rem] text-muted-foreground">
            {description}
          </span>
        </div>
      </div>
    </div>
  )
}

function truncateAddress(address: string) {
  if (address.length <= 10) return address

  return `${address.slice(0, 4)}...${address.slice(-4)}`
}

function formatSolBalance(lamports: bigint | null | undefined) {
  if (lamports === null || lamports === undefined) {
    return "loading..."
  }

  const sol = Number(lamports) / 1_000_000_000

  return `${sol.toLocaleString("en-US", {
    maximumFractionDigits: 4,
  })}`
}

function formatUsdcBalance(value: number | string | null | undefined) {
  if (value === null || value === undefined) {
    return "loading..."
  }

  const numericValue = Number(value)

  if (!Number.isFinite(numericValue)) {
    return `${value}`
  }

  return `${numericValue.toLocaleString("en-US", {
    maximumFractionDigits: 4,
  })}`
}

function getConnectorLabel(connectorId: string, fallback: string) {
  return CONNECTOR_LABELS.get(connectorId) ?? fallback
}

function getConnectorOrder(connectorId: string) {
  const index = CONNECTORS.findIndex(
    (connector) => connector.id === connectorId
  )

  return index === -1 ? CONNECTORS.length : index
}

function getTriggerLabel(flowStep: WalletFlowStep, authLoading: boolean) {
  if (flowStep === "connecting") {
    return "Connecting..."
  }

  if (flowStep === "signing") {
    return "Waiting signature..."
  }

  if (authLoading) {
    return "Checking session..."
  }

  return "Connect Wallet"
}

function getActiveConnectorLabel(flowStep: WalletFlowStep) {
  if (flowStep === "connecting") {
    return "Connecting"
  }

  if (flowStep === "signing") {
    return "Sign next"
  }

  if (flowStep === "disconnecting") {
    return "Disconnecting"
  }

  return "Working"
}

function getSessionStatusLabel({
  authLoading,
  isAuthenticated,
  isConnected,
  isConnectedAuthenticatedWallet,
  needsSignature,
}: {
  authLoading: boolean
  isAuthenticated: boolean
  isConnected: boolean
  isConnectedAuthenticatedWallet: boolean
  needsSignature: boolean
}) {
  if (authLoading) {
    return "Checking session"
  }

  if (isConnectedAuthenticatedWallet) {
    return "Signed in"
  }

  if (needsSignature) {
    return "Signature required"
  }

  if (isAuthenticated) {
    return "Signed in"
  }

  if (isConnected) {
    return "Wallet connected"
  }

  return "Connect wallet"
}

function getWalletErrorMessage(error: unknown, stage: "auth" | "connect") {
  if (error instanceof ApiError) {
    if (error.status >= 500) {
      return "Backend auth failed. Check the backend server log for /v1/auth."
    }

    if (error.status === 401) {
      return "Wallet signature could not be verified. Please sign the latest auth message again."
    }

    return error.message || "Unable to authenticate wallet."
  }

  const normalizedMessage = getStringErrorMessage(error).trim()
  const lowerMessage = normalizedMessage.toLowerCase()

  if (!normalizedMessage || lowerMessage === "unexpected error") {
    return stage === "connect"
      ? "Wallet connector returned an unexpected error. Open your wallet, switch accounts once, then try connecting again."
      : "Wallet signing failed. Please approve the sign-in message in your wallet."
  }

  if (
    lowerMessage.includes("user rejected") ||
    lowerMessage.includes("rejected") ||
    lowerMessage.includes("cancel")
  ) {
    return "Wallet request was cancelled."
  }

  if (
    lowerMessage.includes("wallet not found") ||
    lowerMessage.includes("not installed") ||
    lowerMessage.includes("no wallet")
  ) {
    return "Wallet extension was not detected. Install or unlock your Solana wallet, then try again."
  }

  return normalizedMessage
}

function getStringErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === "string") {
    return error
  }

  try {
    return JSON.stringify(error)
  } catch {
    return ""
  }
}

function getAvailableConnectors(connectors: readonly WalletConnector[]) {
  const hasWalletStandardPhantom = connectors.some(
    (connector) =>
      connector.id === "wallet-standard:phantom" && connector.isSupported()
  )

  const seenLabels = new Set<string>()

  const supportedConnectors = connectors
    .filter((connector) => connector.isSupported())
    .filter((connector) => {
      if (!hasWalletStandardPhantom) return true

      return connector.id !== "phantom:legacy"
    })
    .sort(
      (left, right) => getConnectorOrder(left.id) - getConnectorOrder(right.id)
    )

  return supportedConnectors.filter((connector) => {
    const label = getConnectorLabel(connector.id, connector.name)

    if (seenLabels.has(label)) {
      return false
    }

    seenLabels.add(label)
    return true
  })
}
