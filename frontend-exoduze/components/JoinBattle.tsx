import type { BattleEntry, BattlePool } from "@/hooks/Type"
import { StakePanel } from "@/components/markets/StakePanel"

type JoinBattleProps = {
  battleEntries: BattleEntry[]
  battlePool: BattlePool
  marketIdOrSlug: string
  marketPubkey?: string | null
  joinDeadlineAt?: string | null
  settlementAsset?: string
}

export function JoinBattle(props: JoinBattleProps) {
  return <StakePanel {...props} />
}
