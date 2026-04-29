"use client"

import * as React from "react"

import { DEFAULT_BROWSER_TIME_ZONE } from "@/lib/time-formatters"

const UserTimeZoneContext = React.createContext(DEFAULT_BROWSER_TIME_ZONE)

export function UserTimeZoneProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const timeZone = React.useSyncExternalStore(
    subscribeToTimeZone,
    resolveBrowserTimeZone,
    () => DEFAULT_BROWSER_TIME_ZONE
  )

  return (
    <UserTimeZoneContext.Provider value={timeZone}>
      {children}
    </UserTimeZoneContext.Provider>
  )
}

export function useUserTimeZone() {
  return React.useContext(UserTimeZoneContext)
}

function subscribeToTimeZone() {
  return () => undefined
}

function resolveBrowserTimeZone() {
  try {
    return (
      Intl.DateTimeFormat().resolvedOptions().timeZone ??
      DEFAULT_BROWSER_TIME_ZONE
    )
  } catch {
    return DEFAULT_BROWSER_TIME_ZONE
  }
}
