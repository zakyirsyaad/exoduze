"use client"

import * as React from "react"
import Image from "next/image"

import type { Agent, PageInfo } from "@/hooks/Type"
import { useApi } from "@/hooks/useApi"
import { cn } from "@/lib/utils"

import { Marquee } from "../../ui/marquee"

type HomeAgent = Omit<Agent, "activity" | "avatar_uri" | "categories" | "owner"> & {
  activity?: Agent["activity"]
  avatar_uri?: string | null
  categories?: Agent["categories"]
  owner?: Agent["owner"]
}

type AgentsListResponse = {
  data:
  | HomeAgent[]
  | {
    agents?: HomeAgent[]
    items?: HomeAgent[]
    page_info?: PageInfo
  }
  page_info?: PageInfo
}

const ReviewCard = ({
  img,
  name,
  username,
  body,
}: {
  img?: string | null
  name: string
  username: string
  body: string
}) => {
  return (
    <figure
      className={cn(
        "relative h-full w-64 cursor-pointer overflow-hidden rounded-xl border p-4",
        "border-gray-950/[.1] bg-gray-950/[.01] hover:bg-gray-950/[.05]",
        "dark:border-gray-50/[.1] dark:bg-gray-50/[.10] dark:hover:bg-gray-50/[.15]"
      )}
    >
      <div className="flex flex-row items-center gap-2">
        {img ? (
          <Image
            className="rounded-full object-cover"
            width={32}
            height={32}
            alt={`${name} avatar`}
            src={img}
            unoptimized
          />
        ) : (
          <div className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-lime-200 to-cyan-200 text-xs font-semibold text-neutral-950">
            {getAgentInitials(name)}
          </div>
        )}
        <div className="flex flex-col">
          <figcaption className="text-sm font-medium dark:text-white">
            {name}
          </figcaption>
          <p className="text-xs font-medium dark:text-white/40">{username}</p>
        </div>
      </div>
      <blockquote className="mt-2 text-sm line-clamp-3">{body}</blockquote>
    </figure>
  )
}

export function Ecosystem() {
  const { data, get } = useApi<AgentsListResponse>()

  React.useEffect(() => {
    void get("/v1/agents?limit=12&sort=top_rank")
  }, [get])

  const reviews = React.useMemo(
    () =>
      getAgentsListPayload(data).map((agent) => ({
        name: agent.name,
        username: `@${agent.slug}`,
        body: agent.description || "This agent has not added a description yet.",
        img: agent.avatar_uri,
      })),
    [data]
  )

  return (
    <div className="relative flex w-full flex-col items-center justify-center overflow-hidden">
      {/* <Marquee pauseOnHover className="[--duration:20s]">
                {firstRow.map((review) => (
                    <ReviewCard key={review.username} {...review} />
                ))}
            </Marquee> */}
      <Marquee reverse pauseOnHover className="[--duration:20s]">
        {reviews.map((review) => (
          <ReviewCard key={review.username} {...review} />
        ))}
      </Marquee>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-1/4 bg-gradient-to-r from-background"></div>
      <div className="pointer-events-none absolute inset-y-0 right-0 w-1/4 bg-gradient-to-l from-background"></div>
    </div>
  )
}

function getAgentsListPayload(response: AgentsListResponse | null) {
  if (!response) {
    return []
  }

  if (Array.isArray(response.data)) {
    return response.data
  }

  return response.data.agents ?? response.data.items ?? []
}

function getAgentInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("")
}
