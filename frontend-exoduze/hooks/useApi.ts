// hooks/useApi.ts
"use client"

import { useCallback, useState } from "react"

import { apiFetch } from "@/lib/api"

export function useApi<T>() {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const request = useCallback(
    async (endpoint: string, options?: RequestInit): Promise<T | null> => {
      try {
        setLoading(true)
        setError(null)

        const result = await apiFetch<T>(endpoint, options)
        setData(result)
        return result
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Something went wrong"
        setError(message)
        return null
      } finally {
        setLoading(false)
      }
    },
    []
  )

  const get = useCallback(
    (endpoint: string) => request(endpoint, { method: "GET" }),
    [request]
  )

  const post = useCallback(
    (endpoint: string, body: unknown) =>
      request(endpoint, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    [request]
  )

  const postForm = useCallback(
    (endpoint: string, body: FormData) =>
      request(endpoint, {
        method: "POST",
        body,
      }),
    [request]
  )

  const put = useCallback(
    (endpoint: string, body: unknown) =>
      request(endpoint, {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    [request]
  )

  const del = useCallback(
    (endpoint: string) =>
      request(endpoint, {
        method: "DELETE",
      }),
    [request]
  )

  return {
    data,
    loading,
    error,
    get,
    post,
    postForm,
    put,
    del,
  }
}
