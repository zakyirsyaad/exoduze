"use client"

import * as React from "react"

const getMediaQueryMatch = (query: string) => {
  if (typeof window === "undefined") {
    return false
  }

  return window.matchMedia(query).matches
}

export function useMediaQuery(query: string) {
  return React.useSyncExternalStore(
    (onStoreChange) => {
      if (typeof window === "undefined") {
        return () => undefined
      }

      const mediaQueryList = window.matchMedia(query)

      mediaQueryList.addEventListener("change", onStoreChange)

      return () => mediaQueryList.removeEventListener("change", onStoreChange)
    },
    () => getMediaQueryMatch(query),
    () => false
  )
}
