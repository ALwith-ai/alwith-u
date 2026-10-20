import { SessionUpdate as UpdateGuard } from "@agentclientprotocol/sdk/experimental/v2/unstable"
import type * as acp from "@agentclientprotocol/sdk/experimental/v2/unstable"
import { createSession, SessionStore, type Session } from "@alwith/api"

export type HistoryPageState = { cursor: string | null; loading: boolean; error: string | null }
export type BrowseHistoryRequest = {
  sessionId: string
  mode: "browse"
  sortDirection: "desc"
  itemsView: "full"
  limit: number
  maxBytes: number
  cursor?: string
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid history page")
  return value as Record<string, unknown>
}

/** Fold one bounded page off-screen, then prepend once, preserving newer live upserts. */
export async function readHistoryPage(
  sessionId: string,
  cwd: string,
  cursor: string | null,
  request: (params: BrowseHistoryRequest) => Promise<unknown>
): Promise<{ session: Session; cursor: string | null; turnIds: string[] }> {
  let limit = 5
  let raw: unknown
  while (true) {
    try {
      raw = await request({
        sessionId,
        mode: "browse",
        sortDirection: "desc",
        itemsView: "full",
        limit,
        maxBytes: 16 * 1024 * 1024,
        ...(cursor === null ? {} : { cursor })
      })
      break
    } catch (error) {
      const data = error && typeof error === "object" && "data" in error ? error.data : null
      if (
        data &&
        typeof data === "object" &&
        "reason" in data &&
        data.reason === "history_page_too_large" &&
        limit > 1
      ) {
        limit = Math.max(1, Math.floor(limit / 2))
        continue
      }
      throw error
    }
  }
  const page = object(raw)
  if (
    page.sessionId !== sessionId ||
    page.consistency !== "live" ||
    page.revision !== null ||
    !Array.isArray(page.turns) ||
    (page.nextCursor !== null && (typeof page.nextCursor !== "string" || !page.nextCursor)) ||
    page.complete !== (page.nextCursor === null) ||
    (page.nextCursor !== null && (page.nextCursor === cursor || page.turns.length === 0))
  )
    throw new Error("Invalid history pagination")
  return {
    session: projectHistoryTurns(sessionId, cwd, page.title, [...page.turns].reverse()),
    cursor: page.nextCursor as string | null,
    turnIds: page.turns.map(rawTurn => object(rawTurn).turnId as string)
  }
}

/** The same ACP fold is used by contiguous pages and individual navigation targets. */
export function projectHistoryTurns(sessionId: string, cwd: string, title: unknown, turns: unknown[]): Session {
  const projection = new SessionStore({ toolContent: "replace" })
  if (title !== undefined && title !== null && typeof title !== "string") throw new Error("Invalid history title")
  projection.set(createSession(sessionId, cwd, typeof title === "string" ? title : null))
  projection.beginReplay(sessionId)
  const seen = new Set<string>()
  for (const rawTurn of turns) {
    const turn = object(rawTurn)
    if (
      typeof turn.turnId !== "string" ||
      seen.has(turn.turnId) ||
      turn.itemsView !== "full" ||
      !Array.isArray(turn.updates)
    )
      throw new Error("Invalid history turn")
    seen.add(turn.turnId)
    const timestamp = (value: unknown): number | null => {
      if (value == null) return null
      if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 8.64e12)
        throw new Error("Invalid history timestamp")
      return value * 1000
    }
    const startedAt = timestamp(turn.startedAt)
    const completedAt = timestamp(turn.completedAt)
    const durationMs = turn.durationMs ?? (startedAt !== null && completedAt !== null ? completedAt - startedAt : null)
    if (durationMs !== null && (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 0))
      throw new Error("Invalid history duration")
    let opening = true
    for (const update of turn.updates) {
      const value = object(update)
      if (
        typeof value.sessionUpdate !== "string" ||
        !Object.values(UpdateGuard).some(guard => guard(update as acp.SessionUpdate))
      )
        throw new Error("Unsupported history update")
      const frame = update as acp.SessionUpdate
      const user = opening && UpdateGuard.isUserMessage(frame)
      if (user) opening = false
      const meta = object(frame._meta ?? {})
      const codex = meta.codex
      if (codex != null && (typeof codex !== "object" || Array.isArray(codex)))
        throw new Error("Invalid history metadata")
      projection.accept(sessionId, {
        ...frame,
        _meta: {
          ...meta,
          codex: {
            ...codex,
            turnId: turn.turnId,
            historyReplay: true,
            ...(startedAt === null ? {} : { turnStartedAt: startedAt }),
            ...(completedAt === null ? {} : { turnCompletedAt: completedAt }),
            ...(user && startedAt !== null ? { messageSentAt: startedAt } : {}),
            ...(durationMs === null ? {} : { turnDurationMs: durationMs }),
            ...(turn.status === "interrupted" ? { historyInterrupted: true } : {})
          }
        }
      })
    }
  }
  return projection.get(sessionId)
}

export function prependHistory(current: Session, page: Session, baseline?: Session): Session {
  const identity = (item: Session["items"][number]) => `${item.kind}:${item.id}`
  const existing = new Map(current.items.map(item => [identity(item), item]))
  const before = new Map(baseline?.items.map(item => [identity(item), item]))
  const merged = page.items.map(item => {
    const live = existing.get(identity(item))
    return live !== undefined && (baseline === undefined || live !== before.get(identity(item))) ? live : item
  })
  const pageIds = new Set(page.items.map(identity))
  const overlap = current.items.findIndex(item => pageIds.has(identity(item)))
  const prefix = overlap > 0 ? current.items.slice(0, overlap) : []
  const prefixIds = new Set(prefix.map(identity))
  return {
    ...current,
    title:
      baseline !== undefined && current.title === baseline.title
        ? (page.title ?? current.title)
        : (current.title ?? page.title),
    items: [
      ...prefix,
      ...merged,
      ...current.items.filter(item => !pageIds.has(identity(item)) && !prefixIds.has(identity(item)))
    ],
    clock: Math.max(current.clock, page.clock),
    terminals: { ...page.terminals, ...current.terminals },
    turnUsage: { ...page.turnUsage, ...current.turnUsage },
    turnEndedAt: { ...page.turnEndedAt, ...current.turnEndedAt }
  }
}
