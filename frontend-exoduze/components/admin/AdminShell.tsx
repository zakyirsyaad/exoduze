"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { useAuth } from "@/hooks/useAuth"
import { cn } from "@/lib/utils"

const adminLinks = [
  {
    href: "/admin",
    label: "Overview",
  },
  {
    href: "/admin/catalog",
    label: "Catalog",
  },
  {
    href: "/admin/markets",
    label: "Markets",
  },
  {
    href: "/admin/disputes",
    label: "Disputes",
  },
  {
    href: "/admin/system",
    label: "System",
  },
]

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const auth = useAuth()

  return (
    <main className="mx-4 space-y-6 py-10 md:mx-10 xl:mx-20">
      <section className="overflow-hidden rounded-[2rem] bg-gradient-to-br from-amber-50 via-white to-emerald-50 p-6 ring-1 ring-black/5 dark:from-amber-500/10 dark:via-neutral-950 dark:to-emerald-500/10 dark:ring-white/10">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold tracking-[0.3em] text-amber-700 uppercase dark:text-amber-300">
              Exoduze Admin
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight md:text-5xl">
              Dedicated control surfaces for markets, catalog, disputes, and
              automation.
            </h1>
            <p className="mt-4 text-sm leading-6 text-neutral-600 dark:text-neutral-300">
              This suite turns the old endpoint console into focused operational
              flows. The raw runner in <Link href="/ops" className="underline underline-offset-4">/ops</Link> stays
              available as a fallback.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <StatusCard
              label="Session"
              value={
                auth.loading
                  ? "Checking"
                  : auth.isAuthenticated
                    ? "Connected"
                    : "Guest"
              }
            />
            <StatusCard
              label="Role"
              value={
                auth.loading ? "Checking" : auth.isAdmin ? "Admin" : "Viewer"
              }
            />
            <StatusCard label="Fallback" value="/ops" />
          </div>
        </div>
      </section>

      <nav className="flex flex-wrap gap-2">
        {adminLinks.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`)

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-full px-4 py-2 text-sm font-medium transition",
                active
                  ? "bg-neutral-950 text-white dark:bg-white dark:text-neutral-950"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
              )}
            >
              {item.label}
            </Link>
          )
        })}
        <Link
          href="/ops"
          className="rounded-full border border-black/10 px-4 py-2 text-sm font-medium text-neutral-600 transition hover:bg-secondary dark:border-white/10 dark:text-neutral-300"
        >
          Ops Console
        </Link>
      </nav>

      {children}
    </main>
  )
}

export function AdminGate({
  children,
}: {
  children: React.ReactNode
}) {
  const auth = useAuth()

  if (auth.loading) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-neutral-500">
          Verifying admin session...
        </CardContent>
      </Card>
    )
  }

  if (!auth.isAdmin) {
    return (
      <Card>
        <CardContent className="grid gap-3 p-6 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="rounded">
              Admin Required
            </Badge>
            <Badge variant={auth.isAuthenticated ? "secondary" : "outline"} className="rounded">
              {auth.isAuthenticated ? "Wallet connected" : "Not authenticated"}
            </Badge>
          </div>
          <p className="text-neutral-600 dark:text-neutral-300">
            This area uses admin-protected routes. Connect an admin wallet to
            manage markets, catalog records, disputes, and system jobs.
          </p>
        </CardContent>
      </Card>
    )
  }

  return <>{children}</>
}

function StatusCard({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="rounded-2xl bg-white/85 p-4 ring-1 ring-black/5 backdrop-blur dark:bg-white/5 dark:ring-white/10">
      <p className="text-xs tracking-[0.18em] text-neutral-500 uppercase">
        {label}
      </p>
      <p className="mt-2 text-lg font-semibold">{value}</p>
    </div>
  )
}
