"use client"

import * as React from "react"
import { toast } from "sonner"

import { AdminGate } from "@/components/admin/AdminShell"
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
import {
  createCategory,
  createTopic,
  deleteCategory,
  deleteTopic,
  fetchCatalogIndex,
  patchCategory,
  patchTopic,
  replaceCategory,
  replaceTopic,
} from "@/lib/admin-client"
import type {
  CatalogCategoryListItem,
  CatalogIndex,
  CatalogTopicListItem,
  CategoryMutationInput,
  TopicMutationInput,
} from "@/lib/admin-types"

const defaultCategoryForm: CategoryMutationInput & { target: string } = {
  target: "",
  slug: "",
  name: "",
  description: "",
  sort_order: 0,
  is_active: true,
}

const defaultTopicForm: TopicMutationInput & { target: string } = {
  target: "",
  category: "",
  slug: "",
  name: "",
  description: "",
  is_active: true,
}

export function CatalogAdminPage() {
  const [catalog, setCatalog] = React.useState<CatalogIndex | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [categoryForm, setCategoryForm] = React.useState(defaultCategoryForm)
  const [topicForm, setTopicForm] = React.useState(defaultTopicForm)

  const loadCatalog = React.useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetchCatalogIndex()
      setCatalog(response)
      setTopicForm((current) => ({
        ...current,
        category: current.category || response.categories[0]?.slug || "",
      }))
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load catalog"
      )
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadCatalog()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [loadCatalog])

  const categoryOptions = catalog?.categories ?? []
  const topicGroups = React.useMemo(() => {
    const groups = new Map<string, CatalogTopicListItem[]>()

    for (const topic of catalog?.topics ?? []) {
      const key = topic.category.slug
      const current = groups.get(key) ?? []
      current.push(topic)
      groups.set(key, current)
    }

    return groups
  }, [catalog])

  async function handleSaveCategory() {
    if (!categoryForm.name.trim()) {
      toast.error("Category name is required")
      return
    }

    setSaving(true)

    try {
      const payload: CategoryMutationInput = {
        slug: categoryForm.slug?.trim() || undefined,
        name: categoryForm.name.trim(),
        description: normalizeNullableText(categoryForm.description),
        sort_order: Number(categoryForm.sort_order) || 0,
        is_active: categoryForm.is_active,
      }

      if (categoryForm.target.trim()) {
        await replaceCategory(categoryForm.target.trim(), payload)
        toast.success("Category updated")
      } else {
        await createCategory(payload)
        toast.success("Category created")
      }

      setCategoryForm(defaultCategoryForm)
      await loadCatalog()
    } catch (saveError) {
      toast.error(
        saveError instanceof Error ? saveError.message : "Unable to save category"
      )
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveTopic() {
    if (!topicForm.name.trim() || !topicForm.category.trim()) {
      toast.error("Topic name and category are required")
      return
    }

    setSaving(true)

    try {
      const payload: TopicMutationInput = {
        category: topicForm.category.trim(),
        slug: topicForm.slug?.trim() || undefined,
        name: topicForm.name.trim(),
        description: normalizeNullableText(topicForm.description),
        is_active: topicForm.is_active,
      }

      if (topicForm.target.trim()) {
        await replaceTopic(topicForm.target.trim(), payload)
        toast.success("Topic updated")
      } else {
        await createTopic(payload)
        toast.success("Topic created")
      }

      setTopicForm((current) => ({
        ...defaultTopicForm,
        category: current.category,
      }))
      await loadCatalog()
    } catch (saveError) {
      toast.error(
        saveError instanceof Error ? saveError.message : "Unable to save topic"
      )
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleCategory(category: CatalogCategoryListItem) {
    setSaving(true)

    try {
      await patchCategory(category.slug, {
        is_active: !category.is_active,
      })
      toast.success(
        category.is_active ? "Category archived" : "Category reactivated"
      )
      await loadCatalog()
    } catch (toggleError) {
      toast.error(
        toggleError instanceof Error
          ? toggleError.message
          : "Unable to update category"
      )
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleTopic(topic: CatalogTopicListItem) {
    setSaving(true)

    try {
      await patchTopic(topic.slug, {
        is_active: !topic.is_active,
      })
      toast.success(topic.is_active ? "Topic archived" : "Topic reactivated")
      await loadCatalog()
    } catch (toggleError) {
      toast.error(
        toggleError instanceof Error ? toggleError.message : "Unable to update topic"
      )
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteCategory(categorySlug: string) {
    setSaving(true)

    try {
      await deleteCategory(categorySlug)
      toast.success("Category archived")
      await loadCatalog()
    } catch (deleteError) {
      toast.error(
        deleteError instanceof Error
          ? deleteError.message
          : "Unable to archive category"
      )
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteTopic(topicSlug: string) {
    setSaving(true)

    try {
      await deleteTopic(topicSlug)
      toast.success("Topic archived")
      await loadCatalog()
    } catch (deleteError) {
      toast.error(
        deleteError instanceof Error
          ? deleteError.message
          : "Unable to archive topic"
      )
    } finally {
      setSaving(false)
    }
  }

  function loadCategoryIntoForm(category: CatalogCategoryListItem) {
    setCategoryForm({
      target: category.slug,
      slug: category.slug,
      name: category.name,
      description: category.description ?? "",
      sort_order: category.sort_order ?? 0,
      is_active: category.is_active,
    })
  }

  function loadTopicIntoForm(topic: CatalogTopicListItem) {
    setTopicForm({
      target: topic.slug,
      category: topic.category.slug,
      slug: topic.slug,
      name: topic.name,
      description: topic.description ?? "",
      is_active: topic.is_active,
    })
  }

  return (
    <AdminGate>
      <div className="space-y-6">
        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Card className="bg-white/80 dark:bg-white/5">
            <CardHeader>
              <CardTitle>Category Admin</CardTitle>
              <CardDescription>
                Create or replace category records. Use the optional target field
                for updates.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <label className="grid gap-1 text-sm">
                <span className="text-neutral-500">Target slug or id</span>
                <Input
                  value={categoryForm.target}
                  onChange={(event) =>
                    setCategoryForm((current) => ({
                      ...current,
                      target: event.target.value,
                    }))
                  }
                  placeholder="Leave empty to create a new category"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-neutral-500">Slug</span>
                <Input
                  value={categoryForm.slug}
                  onChange={(event) =>
                    setCategoryForm((current) => ({
                      ...current,
                      slug: event.target.value,
                    }))
                  }
                  placeholder="auto-generated if empty"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-neutral-500">Name</span>
                <Input
                  value={categoryForm.name}
                  onChange={(event) =>
                    setCategoryForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-neutral-500">Description</span>
                <textarea
                  value={categoryForm.description ?? ""}
                  onChange={(event) =>
                    setCategoryForm((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  className="min-h-28 rounded-md border border-input bg-input/20 p-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-neutral-500">Sort Order</span>
                <Input
                  type="number"
                  value={categoryForm.sort_order}
                  onChange={(event) =>
                    setCategoryForm((current) => ({
                      ...current,
                      sort_order: Number(event.target.value) || 0,
                    }))
                  }
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={categoryForm.is_active}
                  onChange={(event) =>
                    setCategoryForm((current) => ({
                      ...current,
                      is_active: event.target.checked,
                    }))
                  }
                />
                <span>Active</span>
              </label>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void handleSaveCategory()} disabled={saving}>
                  {categoryForm.target ? "Save Category" : "Create Category"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setCategoryForm(defaultCategoryForm)}
                >
                  Reset
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white/80 dark:bg-white/5">
            <CardHeader>
              <CardTitle>Topic Admin</CardTitle>
              <CardDescription>
                Create or replace topic records and assign them to a category.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <label className="grid gap-1 text-sm">
                <span className="text-neutral-500">Target slug or id</span>
                <Input
                  value={topicForm.target}
                  onChange={(event) =>
                    setTopicForm((current) => ({
                      ...current,
                      target: event.target.value,
                    }))
                  }
                  placeholder="Leave empty to create a new topic"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-neutral-500">Category</span>
                <select
                  value={topicForm.category}
                  onChange={(event) =>
                    setTopicForm((current) => ({
                      ...current,
                      category: event.target.value,
                    }))
                  }
                  className="h-9 rounded-md border border-input bg-input/20 px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30"
                >
                  {categoryOptions.map((category) => (
                    <option key={category.id} value={category.slug}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-neutral-500">Slug</span>
                <Input
                  value={topicForm.slug}
                  onChange={(event) =>
                    setTopicForm((current) => ({
                      ...current,
                      slug: event.target.value,
                    }))
                  }
                  placeholder="auto-generated if empty"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-neutral-500">Name</span>
                <Input
                  value={topicForm.name}
                  onChange={(event) =>
                    setTopicForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-neutral-500">Description</span>
                <textarea
                  value={topicForm.description ?? ""}
                  onChange={(event) =>
                    setTopicForm((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  className="min-h-28 rounded-md border border-input bg-input/20 p-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30"
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={topicForm.is_active}
                  onChange={(event) =>
                    setTopicForm((current) => ({
                      ...current,
                      is_active: event.target.checked,
                    }))
                  }
                />
                <span>Active</span>
              </label>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void handleSaveTopic()} disabled={saving}>
                  {topicForm.target ? "Save Topic" : "Create Topic"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    setTopicForm((current) => ({
                      ...defaultTopicForm,
                      category: current.category,
                    }))
                  }
                >
                  Reset
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>

        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-4 text-sm text-amber-900 dark:text-amber-100">
            Public read endpoints currently expose only active categories and
            topics. Inactive records can still be replaced or reactivated by
            manually entering their target slug or id in the form above.
          </CardContent>
        </Card>

        {loading ? (
          <Card>
            <CardContent className="p-6 text-sm text-neutral-500">
              Loading catalog overview...
            </CardContent>
          </Card>
        ) : null}

        {error ? (
          <Card>
            <CardHeader>
              <CardTitle>Unable To Load Catalog</CardTitle>
              <CardDescription>{error}</CardDescription>
            </CardHeader>
          </Card>
        ) : null}

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Card className="bg-white/80 dark:bg-white/5">
            <CardHeader>
              <CardTitle>Active Categories</CardTitle>
              <CardDescription>
                Current categories visible from the public catalog list.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {catalog?.categories.length ? (
                catalog.categories.map((category) => (
                  <article
                    key={category.id}
                    className="rounded-2xl border border-black/10 p-4 dark:border-white/10"
                  >
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{category.name}</p>
                          <Badge
                            variant={category.is_active ? "secondary" : "outline"}
                            className="rounded"
                          >
                            {category.is_active ? "Active" : "Inactive"}
                          </Badge>
                        </div>
                        <p className="text-xs text-neutral-500">
                          {category.slug}
                        </p>
                        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
                          {category.description || "No description"}
                        </p>
                      </div>
                      <div className="grid gap-1 text-sm text-neutral-500">
                        <span>{category.market_count} total markets</span>
                        <span>{category.active_market_count} active markets</span>
                        <span>
                          Sort order:{" "}
                          {category.sort_order === null
                            ? "Hidden by public list"
                            : category.sort_order}
                        </span>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        onClick={() => loadCategoryIntoForm(category)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => void handleToggleCategory(category)}
                        disabled={saving}
                      >
                        {category.is_active ? "Archive" : "Reactivate"}
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={() => void handleDeleteCategory(category.slug)}
                        disabled={saving}
                      >
                        Delete
                      </Button>
                    </div>
                  </article>
                ))
              ) : (
                <p className="text-sm text-neutral-500">No categories found.</p>
              )}
            </CardContent>
          </Card>

          <Card className="bg-white/80 dark:bg-white/5">
            <CardHeader>
              <CardTitle>Active Topics</CardTitle>
              <CardDescription>
                Topics grouped by category based on the public category pages.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5">
              {categoryOptions.length ? (
                categoryOptions.map((category) => {
                  const topics = topicGroups.get(category.slug) ?? []

                  return (
                    <div key={category.id} className="grid gap-3">
                      <div className="flex items-center justify-between">
                        <p className="font-medium">{category.name}</p>
                        <Badge variant="outline" className="rounded">
                          {topics.length} topics
                        </Badge>
                      </div>
                      {topics.length ? (
                        topics.map((topic) => (
                          <article
                            key={topic.id}
                            className="rounded-2xl border border-black/10 p-4 dark:border-white/10"
                          >
                            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="font-medium">{topic.name}</p>
                                  <Badge
                                    variant={
                                      topic.is_active ? "secondary" : "outline"
                                    }
                                    className="rounded"
                                  >
                                    {topic.is_active ? "Active" : "Inactive"}
                                  </Badge>
                                </div>
                                <p className="text-xs text-neutral-500">
                                  {topic.slug}
                                </p>
                                <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
                                  {topic.description || "Description unavailable from public list"}
                                </p>
                              </div>
                              <div className="grid gap-1 text-sm text-neutral-500">
                                <span>{topic.market_count} total markets</span>
                                <span>{topic.active_market_count} active markets</span>
                              </div>
                            </div>
                            <div className="mt-4 flex flex-wrap gap-2">
                              <Button
                                variant="outline"
                                onClick={() => loadTopicIntoForm(topic)}
                              >
                                Edit
                              </Button>
                              <Button
                                variant="outline"
                                onClick={() => void handleToggleTopic(topic)}
                                disabled={saving}
                              >
                                {topic.is_active ? "Archive" : "Reactivate"}
                              </Button>
                              <Button
                                variant="destructive"
                                onClick={() => void handleDeleteTopic(topic.slug)}
                                disabled={saving}
                              >
                                Delete
                              </Button>
                            </div>
                          </article>
                        ))
                      ) : (
                        <p className="text-sm text-neutral-500">
                          No topics published for this category yet.
                        </p>
                      )}
                    </div>
                  )
                })
              ) : (
                <p className="text-sm text-neutral-500">No categories loaded.</p>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </AdminGate>
  )
}

function normalizeNullableText(value: string | null | undefined) {
  const trimmedValue = value?.trim() ?? ""
  return trimmedValue ? trimmedValue : null
}
