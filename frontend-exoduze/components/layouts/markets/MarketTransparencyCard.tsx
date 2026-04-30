import type { ReactNode } from "react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { MarketTransparency } from "@/hooks/Type"

import {
  formatActorIdentity,
  formatContextValue,
  formatTextLabel,
} from "./market-detail-helpers"

type MarketTransparencyCardProps = {
  transparency: MarketTransparency
}

export function MarketTransparencyCard({
  transparency,
}: MarketTransparencyCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Transparency</CardTitle>
        <CardDescription>
          Creator, resolver, rules, and market context.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        <div>
          <p className="text-neutral-500">Created By</p>
          <p className="mt-1 text-xs">
            {formatActorIdentity({
              actor: transparency.created_by_actor,
              wallet: transparency.created_by_wallet,
            })}
          </p>
        </div>
        <div>
          <p className="text-neutral-500">Resolver</p>
          <p className="mt-1 text-xs">
            {formatActorIdentity({
              actor: transparency.resolver_actor,
              wallet: transparency.resolver_wallet,
            })}
          </p>
        </div>
        <div>
          <p className="text-neutral-500">Rules</p>
          {transparency.rules.length ? (
            <ul className="mt-2 grid gap-2">
              {transparency.rules.map((rule, index) => (
                <li
                  key={`${String(rule)}-${index}`}
                  className="rounded border border-black/10 px-3 py-2 dark:border-white/10"
                >
                  {formatContextValue(rule)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 font-medium">No rules provided</p>
          )}
        </div>
        <div>
          <p className="text-neutral-500">Market Context</p>
          {Object.keys(transparency.context).length ? (
            <div className="mt-2 grid gap-2">
              {Object.entries(transparency.context).map(([key, value]) => (
                <div
                  key={key}
                  className="rounded border border-black/10 px-3 py-2 dark:border-white/10"
                >
                  <p className="font-medium">{formatTextLabel(key)}</p>
                  {renderContextValue(value, key)}
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-1 font-medium">No context provided</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function renderContextValue(value: unknown, path: string): ReactNode {
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return (
      <p className="mt-1 break-words text-neutral-500">
        {formatContextValue(value)}
      </p>
    )
  }

  if (Array.isArray(value)) {
    if (!value.length) {
      return <p className="mt-1 text-neutral-500">[]</p>
    }

    return (
      <div className="mt-2 grid gap-2">
        {value.map((item, index) => (
          <div
            key={`${path}-${index}`}
            className="rounded border border-black/10 bg-black/[0.02] px-3 py-2 dark:border-white/10 dark:bg-white/5"
          >
            {renderNestedValue(item, `${path}-${index}`)}
          </div>
        ))}
      </div>
    )
  }

  if (isRecord(value)) {
    const entries = Object.entries(value)

    if (!entries.length) {
      return <p className="mt-1 text-neutral-500">{"{}"}</p>
    }

    return (
      <div className="mt-2 grid gap-2">
        {entries.map(([key, nestedValue]) => (
          <div
            key={`${path}-${key}`}
            className="rounded border border-black/10 bg-black/[0.02] px-3 py-2 dark:border-white/10 dark:bg-white/5"
          >
            <p className="font-medium">{formatTextLabel(key)}</p>
            {renderNestedValue(nestedValue, `${path}-${key}`)}
          </div>
        ))}
      </div>
    )
  }

  return (
    <p className="mt-1 break-words text-neutral-500">
      {formatContextValue(value)}
    </p>
  )
}

function renderNestedValue(value: unknown, path: string) {
  if (isRecord(value)) {
    const entries = Object.entries(value)

    if (!entries.length) {
      return <p className="mt-1 text-neutral-500">{"{}"}</p>
    }

    return (
      <div className="grid gap-2">
        {entries.map(([key, nestedValue]) => (
          <div key={`${path}-${key}`}>
            <p className="font-medium">{formatTextLabel(key)}</p>
            {renderContextValue(nestedValue, `${path}-${key}`)}
          </div>
        ))}
      </div>
    )
  }

  if (Array.isArray(value)) {
    return renderContextValue(value, path)
  }

  return (
    <p className="mt-1 break-words text-neutral-500">
      {formatContextValue(value)}
    </p>
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
