"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import type { CategoriesResponse } from "@/hooks/Type"
import { useAuth } from "@/hooks/useAuth"
import { deleteAgent, patchAgent, updateAgent, uploadAgentAvatar } from "@/lib/admin-client"
import { apiFetch } from "@/lib/api"

type ManageableAgent = {
  id: string
  slug: string
  name: string
  description: string
  status: "active" | "inactive"
  avatar_uri?: string | null
  owner?: {
    wallet_address: string
  } | null
  categories?: Array<{
    slug: string
    name: string
  }>
}

type AgentManagementPanelProps = {
  agent: ManageableAgent
}

const avatarAccept = "image/jpeg,image/png,image/webp,image/gif"

export function AgentManagementPanel({
  agent,
}: AgentManagementPanelProps) {
  const auth = useAuth()
  const router = useRouter()
  const [categories, setCategories] = React.useState<
    Array<{ slug: string; name: string }>
  >([])
  const [loadingCategories, setLoadingCategories] = React.useState(false)
  const [working, setWorking] = React.useState(false)
  const [name, setName] = React.useState(agent.name)
  const [slug, setSlug] = React.useState(agent.slug)
  const [description, setDescription] = React.useState(agent.description)
  const [status, setStatus] = React.useState<"active" | "inactive">(
    agent.status
  )
  const [selectedCategories, setSelectedCategories] = React.useState(
    agent.categories?.map((category) => category.slug) ?? []
  )
  const [avatarUri, setAvatarUri] = React.useState(agent.avatar_uri ?? "")
  const [avatarFile, setAvatarFile] = React.useState<File | null>(null)

  React.useEffect(() => {
    let active = true

    async function loadCategories() {
      setLoadingCategories(true)

      try {
        const response = await apiFetch<CategoriesResponse>("/v1/categories", {
          method: "GET",
          auth: false,
        })

        if (!active) {
          return
        }

        setCategories(
          response.data.map((category) => ({
            slug: category.slug,
            name: category.name,
          }))
        )
      } catch {
        if (active) {
          setCategories(agent.categories ?? [])
        }
      } finally {
        if (active) {
          setLoadingCategories(false)
        }
      }
    }

    void loadCategories()

    return () => {
      active = false
    }
  }, [agent.categories])

  const ownerWallet = agent.owner?.wallet_address ?? null
  const isOwner =
    !!ownerWallet &&
    ownerWallet === auth.session?.wallet.wallet_address
  const canManage = auth.isAdmin || isOwner

  if (!canManage) {
    return null
  }

  async function handleSave() {
    if (!name.trim() || !description.trim() || !selectedCategories.length) {
      toast.error("Name, description, and at least one category are required")
      return
    }

    setWorking(true)

    try {
      let nextAvatarUri: string | null = avatarUri.trim() || null

      if (avatarFile) {
        const uploaded = await uploadAgentAvatar(avatarFile)
        nextAvatarUri = uploaded.data.avatar_uri
      }

      await updateAgent(agent.slug, {
        slug: slug.trim() || undefined,
        name: name.trim(),
        description: description.trim(),
        status,
        avatar_uri: nextAvatarUri,
        category_slugs: selectedCategories,
      })

      toast.success("Agent updated")
      router.refresh()
    } catch (saveError) {
      toast.error(
        saveError instanceof Error ? saveError.message : "Unable to update agent"
      )
    } finally {
      setWorking(false)
    }
  }

  async function handleToggleStatus() {
    setWorking(true)

    try {
      const nextStatus = status === "active" ? "inactive" : "active"

      await patchAgent(agent.slug, {
        status: nextStatus,
      })

      setStatus(nextStatus)
      toast.success(`Agent marked ${nextStatus}`)
      router.refresh()
    } catch (toggleError) {
      toast.error(
        toggleError instanceof Error
          ? toggleError.message
          : "Unable to change agent status"
      )
    } finally {
      setWorking(false)
    }
  }

  async function handleDelete() {
    setWorking(true)

    try {
      await deleteAgent(agent.slug)
      toast.success("Agent deleted")
      router.push("/agents")
      router.refresh()
    } catch (deleteError) {
      toast.error(
        deleteError instanceof Error
          ? deleteError.message
          : "Unable to delete agent"
      )
    } finally {
      setWorking(false)
    }
  }

  return (
    <Card className="bg-white/80 dark:bg-white/5">
      <CardHeader>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle>Manage Agent</CardTitle>
            <CardDescription>
              Owner and admin controls for edit, status patch, avatar update,
              and delete.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="rounded">
              {auth.isAdmin ? "Admin access" : "Owner access"}
            </Badge>
            <Badge variant={status === "active" ? "secondary" : "outline"} className="rounded">
              {status}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <section className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-1 text-sm">
            <span className="text-neutral-500">Name</span>
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-neutral-500">Slug</span>
            <Input value={slug} onChange={(event) => setSlug(event.target.value)} />
          </label>
        </section>

        <label className="grid gap-1 text-sm">
          <span className="text-neutral-500">Description</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="min-h-28 rounded-md border border-input bg-input/20 p-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30"
          />
        </label>

        <section className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-1 text-sm">
            <span className="text-neutral-500">Avatar URL</span>
            <Input
              value={avatarUri}
              onChange={(event) => setAvatarUri(event.target.value)}
              placeholder="https://..."
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-neutral-500">Upload New Avatar</span>
            <Input
              type="file"
              accept={avatarAccept}
              onChange={(event) => setAvatarFile(event.target.files?.[0] ?? null)}
            />
          </label>
        </section>

        <label className="grid gap-1 text-sm">
          <span className="text-neutral-500">Categories</span>
          <select
            multiple
            value={selectedCategories}
            onChange={(event) =>
              setSelectedCategories(
                Array.from(event.target.selectedOptions).map(
                  (option) => option.value
                )
              )
            }
            className="min-h-32 rounded-md border border-input bg-input/20 px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30"
          >
            {categories.map((category) => (
              <option key={category.slug} value={category.slug}>
                {category.name}
              </option>
            ))}
          </select>
          <span className="text-xs text-neutral-500">
            {loadingCategories
              ? "Loading categories..."
              : "Hold Ctrl or Cmd to select multiple categories."}
          </span>
        </label>

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void handleSave()} disabled={working}>
            Save Changes
          </Button>
          <Button
            variant="outline"
            onClick={() => void handleToggleStatus()}
            disabled={working}
          >
            Set {status === "active" ? "Inactive" : "Active"}
          </Button>
          <Button
            variant="destructive"
            onClick={() => void handleDelete()}
            disabled={working}
          >
            Delete Agent
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
