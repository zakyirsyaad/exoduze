"use client"

import * as React from "react"
import { useWallet } from "@solana/react-hooks"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useApi } from "@/hooks/useApi"
import { useAuth } from "@/hooks/useAuth"
import type {
  Agent,
  AgentDataFocus,
  AgentRiskProfile,
  AgentSpecialization,
  AgentVisibility,
} from "@/hooks/Type"
import {
  AGENT_DATA_FOCUS_OPTIONS,
  AGENT_RISK_PROFILE_OPTIONS,
  AGENT_SPECIALIZATION_OPTIONS,
  AGENT_VISIBILITY_OPTIONS,
  formatDataFocusLabel,
  formatRiskProfileLabel,
  formatSpecializationLabel,
  getDefaultDataFocusForSpecialization,
} from "@/lib/battle-config"
import { cn } from "@/lib/utils"

const agentAvatarAccept = "image/jpeg,image/png,image/webp,image/gif"
const agentAvatarMimeTypes = new Set(agentAvatarAccept.split(","))

const defaultSpecialization: AgentSpecialization = "general"

type AgentCreateFormState = {
  avatarUri: string
  basePersonality: string
  baseStrategy: string
  dataFocus: AgentDataFocus[]
  description: string
  name: string
  riskProfile: AgentRiskProfile
  specialization: AgentSpecialization
  visibility: AgentVisibility
}

const defaultForm: AgentCreateFormState = {
  avatarUri: "",
  basePersonality: "",
  baseStrategy: "",
  dataFocus: getDefaultDataFocusForSpecialization(defaultSpecialization),
  description: "",
  name: "",
  riskProfile: "balanced",
  specialization: defaultSpecialization,
  visibility: "public",
}

export type CreatedAgent = Agent

type CreateAgentResponse = {
  data: CreatedAgent | { agent: CreatedAgent }
}

type UploadAgentAvatarResponse = {
  data: {
    avatar_uri: string
  }
}

type AgentCreateFormProps = React.ComponentProps<"form"> & {
  onCreated?: (agent: CreatedAgent) => void
}

export function AgentCreateForm({
  className,
  onCreated,
  ...props
}: AgentCreateFormProps) {
  const wallet = useWallet()
  const auth = useAuth()
  const {
    post: createAgent,
    loading: creatingAgent,
    error: createAgentError,
  } = useApi<CreateAgentResponse>()
  const {
    postForm: uploadAgentAvatar,
    loading: uploadingAvatar,
    error: uploadAvatarError,
  } = useApi<UploadAgentAvatarResponse>()
  const [form, setForm] = React.useState(defaultForm)
  const [avatarFile, setAvatarFile] = React.useState<File | null>(null)
  const [formError, setFormError] = React.useState<string | null>(null)
  const avatarInputRef = React.useRef<HTMLInputElement>(null)

  const isBusy = auth.loading || creatingAgent || uploadingAvatar
  const submitError =
    formError ??
    (avatarFile && uploadAvatarError
      ? getCreateAgentErrorMessage(uploadAvatarError)
      : null) ??
    (createAgentError ? getCreateAgentErrorMessage(createAgentError) : null)

  const setField = <Key extends keyof AgentCreateFormState>(
    key: Key,
    value: AgentCreateFormState[Key]
  ) => {
    setForm((currentForm) => ({
      ...currentForm,
      [key]: value,
    }))
    setFormError(null)
  }

  const handleSpecializationChange = (value: AgentSpecialization) => {
    setForm((currentForm) => {
      const currentDefault = getDefaultDataFocusForSpecialization(
        currentForm.specialization
      )
      const nextDefault = getDefaultDataFocusForSpecialization(value)
      const shouldResetFocus =
        !currentForm.dataFocus.length ||
        currentForm.dataFocus.every((item) => currentDefault.includes(item))

      return {
        ...currentForm,
        specialization: value,
        dataFocus: shouldResetFocus ? nextDefault : currentForm.dataFocus,
      }
    })
    setFormError(null)
  }

  const toggleDataFocus = (value: AgentDataFocus) => {
    setForm((currentForm) => {
      const nextFocus = currentForm.dataFocus.includes(value)
        ? currentForm.dataFocus.filter((item) => item !== value)
        : [...currentForm.dataFocus, value]

      return {
        ...currentForm,
        dataFocus: nextFocus,
      }
    })
  }

  const handleAvatarFileChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0] ?? null

    if (file && !agentAvatarMimeTypes.has(file.type)) {
      event.target.value = ""
      setAvatarFile(null)
      setFormError("Avatar must be a JPEG, PNG, WebP, or GIF image.")
      return
    }

    setAvatarFile(file)
    setFormError(null)
  }

  const ensureAuthSession = async () => {
    const connectedAddress =
      wallet.status === "connected"
        ? wallet.session.account.address.toString()
        : null

    if (
      auth.session &&
      (!connectedAddress ||
        auth.session.wallet.wallet_address === connectedAddress)
    ) {
      return auth.session
    }

    if (wallet.status !== "connected") {
      throw new Error("Connect your Solana wallet before creating an AI agent.")
    }

    return auth.loginWithWallet(wallet.session)
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError(null)

    const name = form.name.trim()
    const description = form.description.trim()
    const basePersonality = form.basePersonality.trim()
    const baseStrategy = form.baseStrategy.trim()

    if (!name) {
      setFormError("Name is required.")
      return
    }

    if (!basePersonality) {
      setFormError("Base personality is required.")
      return
    }

    if (!baseStrategy) {
      setFormError("Base strategy is required.")
      return
    }

    if (!form.riskProfile) {
      setFormError("Risk profile is required.")
      return
    }

    try {
      await ensureAuthSession()
      let avatarUri = form.avatarUri.trim() || null

      if (avatarFile) {
        const avatarFormData = new FormData()
        avatarFormData.append("file", avatarFile)

        const uploadedAvatar = await uploadAgentAvatar(
          "/v1/uploads/agent-avatar",
          avatarFormData
        )

        if (!uploadedAvatar?.data.avatar_uri) {
          return
        }

        avatarUri = uploadedAvatar.data.avatar_uri
      }

      const createdAgentResponse = await createAgent("/v1/agents", {
        avatar_uri: avatarUri,
        base_personality: basePersonality,
        base_strategy: baseStrategy,
        category_slugs: [form.specialization],
        data_focus: form.dataFocus,
        description,
        name,
        risk_profile: form.riskProfile,
        specialization: form.specialization,
        status: "active",
        visibility: form.visibility,
      })

      if (!createdAgentResponse) {
        return
      }

      const createdAgent = getCreatedAgent(createdAgentResponse)
      toast.success(`${createdAgent.name} created`)
      setForm(defaultForm)
      setAvatarFile(null)
      onCreated?.(createdAgent)

      if (avatarInputRef.current) {
        avatarInputRef.current.value = ""
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to authenticate wallet"
      setFormError(message)
      toast.error(message)
    }
  }

  return (
    <form
      {...props}
      className={cn("grid items-start gap-5", className)}
      onSubmit={handleSubmit}
    >
      <div className="space-y-1">
        <h3 className="text-lg font-semibold">Create Your AI Agent</h3>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Define your agent&apos;s identity, behavior, and prediction style.
        </p>
      </div>

      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="agent-name">Name</FieldLabel>
          <Input
            id="agent-name"
            value={form.name}
            onChange={(event) => setField("name", event.target.value)}
            disabled={isBusy}
            required
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="agent-description">Description</FieldLabel>
          <textarea
            id="agent-description"
            value={form.description}
            onChange={(event) => setField("description", event.target.value)}
            placeholder="Tell people what this agent is built to do."
            className={textareaClassName}
            disabled={isBusy}
          />
        </Field>

        <div className="grid gap-4 md:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="agent-avatar-uri">Avatar URL</FieldLabel>
            <Input
              id="agent-avatar-uri"
              value={form.avatarUri}
              onChange={(event) => setField("avatarUri", event.target.value)}
              placeholder="https://..."
              disabled={isBusy}
            />
            <FieldDescription>
              Optional. Paste an image URL or upload a file below.
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="agent-avatar-file">Avatar Upload</FieldLabel>
            <Input
              ref={avatarInputRef}
              id="agent-avatar-file"
              type="file"
              accept={agentAvatarAccept}
              onChange={handleAvatarFileChange}
              disabled={isBusy}
            />
          </Field>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="agent-specialization">
              Specialization
            </FieldLabel>
            <Select
              value={form.specialization}
              onValueChange={(value) =>
                handleSpecializationChange(value as AgentSpecialization)
              }
              disabled={isBusy}
            >
              <SelectTrigger id="agent-specialization">
                <SelectValue placeholder="Select specialization" />
              </SelectTrigger>
              <SelectContent>
                {AGENT_SPECIALIZATION_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {formatSpecializationLabel(option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel htmlFor="agent-risk-profile">Risk Profile</FieldLabel>
            <Select
              value={form.riskProfile}
              onValueChange={(value) =>
                setField("riskProfile", value as AgentRiskProfile)
              }
              disabled={isBusy}
            >
              <SelectTrigger id="agent-risk-profile">
                <SelectValue placeholder="Select risk profile" />
              </SelectTrigger>
              <SelectContent>
                {AGENT_RISK_PROFILE_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {formatRiskProfileLabel(option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <Field>
          <FieldLabel htmlFor="agent-base-personality">
            Base Personality
          </FieldLabel>
          <textarea
            id="agent-base-personality"
            value={form.basePersonality}
            onChange={(event) =>
              setField("basePersonality", event.target.value)
            }
            placeholder="How should this agent think, speak, and behave?"
            className={textareaClassName}
            disabled={isBusy}
            required
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="agent-base-strategy">Base Strategy</FieldLabel>
          <textarea
            id="agent-base-strategy"
            value={form.baseStrategy}
            onChange={(event) => setField("baseStrategy", event.target.value)}
            placeholder="Describe the persistent edge or process this agent should follow."
            className={textareaClassName}
            disabled={isBusy}
            required
          />
        </Field>

        <Field>
          <FieldLabel>Data Focus</FieldLabel>
          <div className="grid gap-2 sm:grid-cols-2">
            {AGENT_DATA_FOCUS_OPTIONS.map((option) => {
              const checked = form.dataFocus.includes(option)

              return (
                <label
                  key={option}
                  className={cn(
                    "flex items-center justify-between rounded-xl border border-black/10 px-3 py-2 text-sm transition dark:border-white/10",
                    checked
                      ? "border-emerald-500/50 bg-emerald-500/5"
                      : "bg-white/70 dark:bg-white/5"
                  )}
                >
                  <span>{formatDataFocusLabel(option)}</span>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={isBusy}
                    onChange={() => toggleDataFocus(option)}
                  />
                </label>
              )
            })}
          </div>
          <FieldDescription>
            Choose the signals this agent should emphasize by default.
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="agent-visibility">Visibility</FieldLabel>
          <Select
            value={form.visibility}
            onValueChange={(value) =>
              setField("visibility", value as AgentVisibility)
            }
            disabled={isBusy}
          >
            <SelectTrigger id="agent-visibility">
              <SelectValue placeholder="Select visibility" />
            </SelectTrigger>
            <SelectContent>
              {AGENT_VISIBILITY_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {formatSpecializationLabel(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {submitError ? <FieldError>{submitError}</FieldError> : null}

        <Button type="submit" disabled={isBusy}>
          {auth.loading
            ? "Preparing auth..."
            : uploadingAvatar
              ? "Uploading avatar..."
              : creatingAgent
                ? "Creating..."
                : "Create Agent"}
        </Button>
      </FieldGroup>
    </form>
  )
}

function getCreatedAgent(response: CreateAgentResponse) {
  if ("agent" in response.data) {
    return response.data.agent
  }

  return response.data
}

function getCreateAgentErrorMessage(error: string) {
  const normalizedError = error.toUpperCase()

  if (normalizedError.includes("AUTH_REQUIRED")) {
    return "Session expired. Connect wallet and sign the auth message again."
  }

  if (normalizedError.includes("AGENT_OWNER_FORBIDDEN")) {
    return "This wallet cannot assign an agent to another owner."
  }

  if (
    normalizedError.includes("AGENT_CATEGORIES_INVALID") ||
    normalizedError.includes("AGENT_CATEGORIES_REQUIRED")
  ) {
    return "This specialization is not available right now."
  }

  if (normalizedError.includes("AGENT_SLUG_CONFLICT")) {
    return "An agent with that name already exists for this wallet."
  }

  return error
}

const textareaClassName =
  "min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
