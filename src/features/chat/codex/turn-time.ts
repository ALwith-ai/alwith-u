import { format, isToday } from "date-fns"

import type { Turn } from "../turns"

/** Only native timestamps or the locally recorded send time belong on message actions. */
export function formatTurnTime(
  turn: Turn,
  role: "user" | "assistant" = "user"
): { short: string; full: string } | null {
  const historical =
    turn.replayed ||
    turn.items.some(
      item =>
        item._meta?.codex &&
        typeof item._meta.codex === "object" &&
        "historyReplay" in item._meta.codex &&
        item._meta.codex.historyReplay === true
    )
  const timestamp =
    role === "user"
      ? (nativeTime(turn.user?._meta, "messageSentAt") ?? (!historical ? (turn.user?.at ?? null) : null))
      : (nativeTime(turn.final.at(-1)?._meta, "messageCompletedAt") ??
        turn.items.map(item => nativeTime(item._meta, "turnCompletedAt")).find(value => value !== null) ??
        null)
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

function nativeTime(meta: Record<string, unknown> | null | undefined, field: string): number | null {
  const codex = meta?.codex
  if (typeof codex !== "object" || codex === null) return null
  const value = (codex as Record<string, unknown>)[field]
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 8.64e15 ? value : null
}
