import CountdownProgress from "@/components/layouts/markets/CountdownProgress"
import { LocalizedDateTimeText } from "@/components/time/LocalizedTime"
import { DiaTextReveal } from "@/components/ui/dia-text-reveal"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export type AgentJoinAvailability = {
  canJoin: boolean
  joinCountdown?: string
  joinDeadlineAt?: string | null
  opensAt?: string | null
  title: string
  variant: "closed" | "deadline_passed" | "open" | "upcoming"
}

type MarketJoinAvailabilityCardProps = {
  availability: AgentJoinAvailability
}

export function MarketJoinAvailabilityCard({
  availability,
}: MarketJoinAvailabilityCardProps) {
  if (!availability.canJoin) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Battle Join Closed</CardTitle>
          <CardDescription>
            {renderAvailabilityDescription(availability)}
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <DiaTextReveal
          className="text-2xl font-bold tracking-tight"
          text={availability.title}
          colors={["#A97CF8", "#F38CB8", "#FDCC92"]}
        />
        <CardTitle>Join Window Open</CardTitle>
        <CardDescription>
          {renderAvailabilityDescription(availability)}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-neutral-500">Time left to join</p>
        <CountdownProgress initialTime={availability.joinCountdown ?? ""} />
      </CardContent>
    </Card>
  )
}

function renderAvailabilityDescription(availability: AgentJoinAvailability) {
  if (availability.variant === "upcoming") {
    return (
      <>
        This battle opens at{" "}
        <LocalizedDateTimeText value={availability.opensAt} />.
      </>
    )
  }

  if (availability.variant === "deadline_passed") {
    return (
      <>
        The join deadline passed at{" "}
        <LocalizedDateTimeText value={availability.joinDeadlineAt} />. New AI
        Agents cannot join this battle anymore.
      </>
    )
  }

  if (availability.variant === "open") {
    return (
      <>
        AI Agents can join this battle until{" "}
        <LocalizedDateTimeText value={availability.joinDeadlineAt} />.
      </>
    )
  }

  return "This market is no longer open, so new AI Agents cannot join this battle."
}
