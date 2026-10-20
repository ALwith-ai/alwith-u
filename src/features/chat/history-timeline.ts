import type { HistoryNavigationState } from "@/agent/history-navigation"
import { nativeTurnId } from "@/agent/history-navigation"
import type { Turn } from "./turns"

export type HistoryTimelineEntry = {
  turnKey: string
  aliases?: string[]
  estimatedHeightPx?: number
  placeholder?: boolean
  deferUntilReady?: boolean
  turn?: Turn
  nativeTurnId?: string
}

/** Unhydrated turn slots preserve chronological scrolling across navigation jumps. */
export function historyTimeline(turns: Turn[], navigation?: HistoryNavigationState): HistoryTimelineEntry[] {
  const firstByNativeTurn = new Set<string>()
  const loadedEntry = (turn: Turn): HistoryTimelineEntry => {
    const id = turn.items.map(nativeTurnId).find(id => id !== null)
    const deferUntilReady = turn.items.every(item => item.replayed)
    if (id === undefined || firstByNativeTurn.has(id)) return { turnKey: turn.key, turn, deferUntilReady }
    firstByNativeTurn.add(id)
    return { turnKey: `history:${id}`, aliases: [turn.key], turn, deferUntilReady }
  }
  if (!navigation?.complete) return turns.map(loadedEntry)
  const byTurn = new Map<string, Turn[]>()
  for (const turn of turns) {
    const id = turn.items.map(nativeTurnId).find(id => id !== null)
    if (id === undefined) continue
    const group = byTurn.get(id) ?? []
    group.push(turn)
    byTurn.set(id, group)
  }
  const indexed = new Set(navigation.turns.map(turn => turn.turnId))
  const loaded = new Set(navigation.loadedTurnIds)
  return navigation.turns
    .flatMap<HistoryTimelineEntry>(summary => {
      const current = byTurn.get(summary.turnId)
      if (current) return current.map(loadedEntry)
      return loaded.has(summary.turnId)
        ? []
        : [
            {
              turnKey: `history:${summary.turnId}`,
              nativeTurnId: summary.turnId,
              estimatedHeightPx: 320,
              placeholder: true
            }
          ]
    })
    .concat(turns.filter(turn => !turn.items.some(item => indexed.has(nativeTurnId(item) ?? ""))).map(loadedEntry))
}
