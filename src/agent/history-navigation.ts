import { SessionUpdate } from "@agentclientprotocol/sdk/experimental/v2/unstable"
import type * as acp from "@agentclientprotocol/sdk/experimental/v2/unstable"
import { type Item, type Session, textOf } from "@alwith/api"

import { codexMessageError } from "./codex-extensions"
import { prependHistory, projectHistoryTurns } from "./history-page"

export type HistoryTurnSummary = {
  turnId: string
  status?: string
  startedAt?: number | null
  completedAt?: number | null
  durationMs?: number | null
  errorUpdates?: acp.SessionUpdate[]
}
export type HistoryTurnPreview = {
  state: "loading" | "loaded" | "unavailable"
  messages: Array<{ id: string; label: string; response: string }>
}
export type HistoryNavigationState = {
  turns: HistoryTurnSummary[]
  loadedTurnIds: string[]
  loading: boolean
  complete: boolean
  error: string | null
  previews: Record<string, HistoryTurnPreview>
  turnErrors: Record<string, string>
}
type Request = (method: string, params: Record<string, unknown>) => Promise<unknown>

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid history navigation response")
  return value as Record<string, unknown>
}

function pageOf(raw: unknown, sessionId: string, cursor: string | null, seen: Set<string>) {
  const page = object(raw)
  if (
    page.sessionId !== sessionId ||
    page.consistency !== "live" ||
    page.revision !== null ||
    (page.nextCursor !== null &&
      (typeof page.nextCursor !== "string" || !page.nextCursor || seen.has(page.nextCursor))) ||
    page.complete !== (page.nextCursor === null) ||
    (page.nextCursor === cursor && cursor !== null)
  )
    throw new Error("Invalid history navigation pagination")
  if (typeof page.nextCursor === "string") seen.add(page.nextCursor)
  return page
}

/** Load only native turn metadata; message bodies remain in Codex until requested. */
export async function readHistoryIndex(
  sessionId: string,
  request: Request,
  check: () => void
): Promise<HistoryTurnSummary[]> {
  const turns: HistoryTurnSummary[] = []
  const seen = new Set<string>()
  const ids = new Set<string>()
  let cursor: string | null = null
  do {
    check()
    const page = pageOf(
      await request("_codex/session_history", {
        sessionId,
        mode: "browse",
        sortDirection: "desc",
        itemsView: "summary",
        limit: 100,
        maxBytes: 1024 * 1024,
        ...(cursor === null ? {} : { cursor })
      }),
      sessionId,
      cursor,
      seen
    )
    check()
    if (!Array.isArray(page.turns) || (page.nextCursor !== null && page.turns.length === 0))
      throw new Error("History index made no progress")
    for (const raw of page.turns) {
      const turn = object(raw)
      if (
        typeof turn.turnId !== "string" ||
        !turn.turnId ||
        ids.has(turn.turnId) ||
        turn.itemsView !== "summary" ||
        !Array.isArray(turn.updates)
      )
        throw new Error("Invalid history turn index")
      for (const key of ["startedAt", "completedAt", "durationMs"])
        if (turn[key] != null && (typeof turn[key] !== "number" || !Number.isFinite(turn[key])))
          throw new Error("Invalid history turn time")
      ids.add(turn.turnId)
      turns.push({
        turnId: turn.turnId,
        status: typeof turn.status === "string" ? turn.status : undefined,
        startedAt: turn.startedAt as number | null,
        completedAt: turn.completedAt as number | null,
        durationMs: turn.durationMs as number | null,
        errorUpdates: turn.updates.filter((rawUpdate: unknown): rawUpdate is acp.SessionUpdate => {
          const update = object(rawUpdate) as acp.SessionUpdate
          if (!SessionUpdate.isAgentMessage(update)) return false
          if (!Array.isArray(update.content)) throw new Error("Invalid history error content")
          return codexMessageError({ content: update.content, _meta: update._meta ?? null }) !== null
        })
      })
    }
    cursor = page.nextCursor as string | null
  } while (cursor !== null)
  return turns.toReversed()
}

/** Preview reads are bounded; navigation hydrates the selected turn without walking earlier turns. */
export async function readHistoryTurn(
  sessionId: string,
  cwd: string,
  turn: HistoryTurnSummary,
  request: Request,
  check: () => void,
  preview = false
): Promise<Session> {
  const updates: unknown[] = []
  const seen = new Set<string>()
  const ids = new Set<string>()
  let cursor: string | null = null
  let limit = 30
  let title: unknown
  do {
    check()
    let raw: unknown
    try {
      raw = await request("_codex/session_history_items", {
        sessionId,
        turnId: turn.turnId,
        mode: "browse",
        sortDirection: "asc",
        limit,
        maxBytes: 16 * 1024 * 1024,
        ...(cursor === null ? {} : { cursor })
      })
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
    check()
    const page = pageOf(raw, sessionId, cursor, seen)
    if (!Array.isArray(page.items) || (page.nextCursor !== null && page.items.length === 0))
      throw new Error("History turn made no progress")
    title = page.title
    for (const rawItem of page.items) {
      const item = object(rawItem)
      if (
        item.turnId !== turn.turnId ||
        typeof item.itemId !== "string" ||
        ids.has(item.itemId) ||
        !Array.isArray(item.updates)
      )
        throw new Error("Invalid history turn item")
      ids.add(item.itemId)
      updates.push(...(item.updates as unknown[]))
    }
    if (preview && page.nextCursor !== null) {
      // Codex previews the tail while retaining the opening prompt. Bound both reads.
      const tail = pageOf(
        await request("_codex/session_history_items", {
          sessionId,
          turnId: turn.turnId,
          mode: "browse",
          sortDirection: "desc",
          limit,
          maxBytes: 16 * 1024 * 1024
        }),
        sessionId,
        null,
        new Set()
      )
      check()
      if (!Array.isArray(tail.items)) throw new Error("Invalid history preview tail")
      for (const rawItem of (tail.items as unknown[]).toReversed()) {
        const item = object(rawItem)
        if (item.turnId !== turn.turnId || typeof item.itemId !== "string" || !Array.isArray(item.updates))
          throw new Error("Invalid history preview item")
        if (!ids.has(item.itemId)) {
          ids.add(item.itemId)
          updates.push(...(item.updates as unknown[]))
        }
      }
    }
    cursor = preview ? null : (page.nextCursor as string | null)
  } while (cursor !== null)
  const projectedUpdates = preview
    ? updates.filter((update) => {
        const value = update as Parameters<typeof SessionUpdate.isUserMessage>[0]
        return (
          SessionUpdate.isUserMessage(value) ||
          SessionUpdate.isAgentMessage(value) ||
          SessionUpdate.isAgentMessageChunk(value)
        )
      })
    : updates
  return projectHistoryTurns(sessionId, cwd, title, [
    { ...turn, itemsView: "full", updates: [...projectedUpdates, ...(turn.errorUpdates ?? [])] }
  ])
}

export function nativeTurnId(item: Item): string | null {
  const codex = item._meta?.codex
  return codex && typeof codex === "object" && "turnId" in codex && typeof codex.turnId === "string"
    ? codex.turnId
    : null
}

/** Sparse hydration and contiguous pagination share one chronological in-memory projection. */
export function mergeNavigationHistory(current: Session, page: Session, turns: HistoryTurnSummary[]): Session {
  const merged = prependHistory(current, page)
  const order = new Map(turns.map((turn, index) => [turn.turnId, index]))
  const ranks = merged.items.map((item) => order.get(nativeTurnId(item) ?? ""))
  // Locally inserted prompts can precede their first native turn metadata update.
  let next = turns.length
  for (let index = ranks.length - 1; index >= 0; index--) {
    if (ranks[index] !== undefined) next = ranks[index] as number
    else ranks[index] = next
  }
  const ranked = merged.items.map((item, index) => ({ item, rank: ranks[index] as number }))
  ranked.sort((a, b) => a.rank - b.rank)
  return { ...merged, items: ranked.map((entry) => entry.item) }
}

export function historyTurnPreview(session: Session): HistoryTurnPreview {
  const messages: HistoryTurnPreview["messages"] = []
  for (const item of session.items) {
    if (item.kind === "user") messages.push({ id: item.id, label: textOf(item.content).trim(), response: "" })
    else if (item.kind === "assistant") {
      const meta = item._meta?.codex
      if (meta && typeof meta === "object" && "phase" in meta && meta.phase === "commentary") continue
      const message = messages.at(-1)
      if (message) message.response = textOf(item.content).trim()
    }
  }
  const clip = (text: string) => {
    const characters = [...text]
    return characters.length <= 240 ? text : `${characters.slice(0, 239).join("")}…`
  }
  return {
    state: "loaded",
    messages: messages.map((message) => ({ ...message, label: clip(message.label), response: clip(message.response) }))
  }
}
