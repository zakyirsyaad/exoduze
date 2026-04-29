"use client"

import * as React from "react"
import { useWallet } from "@solana/react-hooks"
import { toast } from "sonner"

import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useApi } from "@/hooks/useApi"
import { useAuth } from "@/hooks/useAuth"
import type { CategoriesResponse } from "@/hooks/Type"
import { cn } from "@/lib/utils"

const defaultAgentCategories = [
  { slug: "politics", name: "Politics" },
  { slug: "esports", name: "Esports" },
  { slug: "finance", name: "Finance" },
  { slug: "tech", name: "Tech" },
  { slug: "crypto", name: "Crypto" },
  { slug: "sports", name: "Sports" },
  { slug: "economy", name: "Economy" },
  { slug: "science", name: "Science" },
] as const

const defaultCreateAgentForm = {
  categorySlug: "finance",
  description: "",
  name: "",
}

const agentAvatarAccept = "image/jpeg,image/png,image/webp,image/gif"
const agentAvatarMimeTypes = new Set(agentAvatarAccept.split(","))

type CreateAgentFormState = typeof defaultCreateAgentForm

export type CreatedAgent = {
  id: string
  slug: string
  name: string
  description: string
  status: "active" | "inactive"
  avatar_uri: string | null
}

type CreateAgentResponse = {
  data: CreatedAgent | { agent: CreatedAgent }
}

type UploadAgentAvatarResponse = {
  data: {
    avatar_uri: string
  }
}

type CreateAgentFormProps = React.ComponentProps<"form"> & {
  onCreated?: (agent: CreatedAgent) => void
}

export function CreateAgentForm({
  className,
  onCreated,
  ...props
}: CreateAgentFormProps) {
  const wallet = useWallet()
  const auth = useAuth()
  const {
    data: categoriesData,
    get: getCategories,
    loading: loadingCategories,
    error: categoriesError,
  } = useApi<CategoriesResponse>()
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
  const [form, setForm] = React.useState<CreateAgentFormState>(
    defaultCreateAgentForm
  )
  const [avatarFile, setAvatarFile] = React.useState<File | null>(null)
  const [formError, setFormError] = React.useState<string | null>(null)
  const avatarInputRef = React.useRef<HTMLInputElement>(null)

  const categoryOptions = React.useMemo<
    Array<{ slug: string; name: string }>
  >(() => {
    if (categoriesData?.data?.length) {
      return categoriesData.data.map((category) => ({
        slug: category.slug,
        name: category.name,
      }))
    }

    return [...defaultAgentCategories]
  }, [categoriesData])
  const submitError = formError
    ? formError
    : uploadAvatarError && avatarFile
      ? getCreateAgentErrorMessage(uploadAvatarError)
      : createAgentError
        ? getCreateAgentErrorMessage(createAgentError)
        : null
  const isBusy = auth.loading || uploadingAvatar || creatingAgent
  const selectedCategorySlug = categoryOptions.some(
    (category) => category.slug === form.categorySlug
  )
    ? form.categorySlug
    : (categoryOptions[0]?.slug ?? defaultCreateAgentForm.categorySlug)

  React.useEffect(() => {
    void getCategories("/v1/categories")
  }, [getCategories])

  const updateFormField = (
    field: keyof CreateAgentFormState,
    value: string
  ) => {
    setForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }))
    setFormError(null)
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

  const handleSubmitCreateAgent = async (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault()
    setFormError(null)

    const name = form.name.trim()
    const description = form.description.trim()
    const categorySlug = selectedCategorySlug

    if (!name || !description || !categorySlug) {
      setFormError("Name, description, and category are required.")
      return
    }

    try {
      await ensureAuthSession()
      let avatarUri: string | null = null

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
        name,
        description,
        status: "active",
        avatar_uri: avatarUri,
        category_slugs: [categorySlug],
      })

      if (!createdAgentResponse) {
        return
      }

      const createdAgent = getCreatedAgent(createdAgentResponse)
      toast.success(`${createdAgent.name} created`)
      setForm(defaultCreateAgentForm)
      setAvatarFile(null)
      onCreated?.(createdAgent)

      if (avatarInputRef.current) {
        avatarInputRef.current.value = ""
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to authenticate wallet"
      setFormError(message)
      toast.error(message)
    }
  }

  return (
    <form
      {...props}
      className={cn("grid items-start gap-4", className)}
      onSubmit={handleSubmitCreateAgent}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="agent-name">Name Agent</FieldLabel>
          <Input
            id="agent-name"
            type="text"
            value={form.name}
            onChange={(event) => updateFormField("name", event.target.value)}
            disabled={isBusy}
            required
          />
          <FieldDescription>
            Choose a unique name for your AI Agent.
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="agent-description">Agent Description</FieldLabel>
          <textarea
            id="agent-description"
            value={form.description}
            onChange={(event) =>
              updateFormField("description", event.target.value)
            }
            placeholder="Describe the agent's strategy, strengths, and market focus."
            className={cn(
              "min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none",
              "placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
            )}
            disabled={isBusy}
            required
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="agent-avatar-file">Picture Agent</FieldLabel>
          <Input
            ref={avatarInputRef}
            id="agent-avatar-file"
            type="file"
            accept={agentAvatarAccept}
            onChange={handleAvatarFileChange}
            disabled={isBusy}
          />
          <FieldDescription>
            {avatarFile
              ? `${avatarFile.name} selected.`
              : "Optional. Select JPEG, PNG, WebP, or GIF; backend uploads it to storage."}
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="agent-category">Agent Category</FieldLabel>
          <Select
            value={selectedCategorySlug}
            onValueChange={(value) => updateFormField("categorySlug", value)}
            disabled={isBusy}
          >
            <SelectTrigger id="agent-category" className="w-full">
              <SelectValue placeholder="Select category" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {categoryOptions.map((category) => (
                  <SelectItem key={category.slug} value={category.slug}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription>
            {loadingCategories
              ? "Loading categories..."
              : categoriesError
                ? "Using default categories because categories failed to load."
                : "Select a category for AI Agent."}
          </FieldDescription>
        </Field>

        {submitError ? <FieldError>{submitError}</FieldError> : null}

        <Button type="submit" disabled={isBusy}>
          {auth.loading
            ? "Preparing auth..."
            : uploadingAvatar
              ? "Uploading avatar..."
              : creatingAgent
                ? "Creating..."
                : "Create AI Agent"}
        </Button>
      </FieldGroup>
    </form>
  )
}

function getCreateAgentErrorMessage(error: string) {
  const normalizedError = error.toUpperCase()

  if (normalizedError.includes("AUTH_REQUIRED")) {
    return "Session expired. Connect wallet and sign the auth message again."
  }

  if (normalizedError.includes("AGENT_OWNER_FORBIDDEN")) {
    return "This wallet cannot assign an agent to another owner."
  }

  if (normalizedError.includes("AGENT_CATEGORIES_INVALID")) {
    return "Selected agent category is invalid. Choose another category."
  }

  if (normalizedError.includes("AGENT_SLUG_CONFLICT")) {
    return "Agent name or slug is already used. Choose another name."
  }

  return error
}

function getCreatedAgent(response: CreateAgentResponse) {
  return "agent" in response.data ? response.data.agent : response.data
}
