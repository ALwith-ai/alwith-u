import { format, isToday } from "date-fns"
import { codexTurnStartedAt } from "@/agent/codex-extensions"
import type { Turn } from "../turns"

/** Desktop's two date formats: today's time, or month/day + time; full date on hover. */
export function formatTurnTime(turn: Turn): { short: string; full: string } | null {
  const nativeTime = turn.items.map(item => codexTurnStartedAt(item._meta)).find(time => time !== null)
  const timestamp = nativeTime ?? (turn.replayed ? null : turn.startedAt)
  if (timestamp === null) return null
  const date = new Date(timestamp)
  return {
    short: new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      ...(isToday(date) ? {} : { month: "short", day: "numeric" })
    }).format(date),
    full: format(date, "yyyy-MM-dd HH:mm")
  }
}
