// Groups a session into Codex-style turns: the user's message, the work Codex did
// (reasoning, tools, plans, commentary) and the final answer.
//
// The grouping itself — which items belong to which turn, when a turn started and
// ended, its usage — is `turns()` from @alwith/api; every app needs that and
// it is the same for all of them. What is ours is the Codex dialect on top: which
// assistant messages are the final answer versus commentary (`_meta.codex.phase`),
// what counts as an edit, and stable keys so memoised turn components survive streaming.

import type { CompactionItem, MessageItem, PlanItem, ToolItem } from "@alwith/api"
import { turns as groupSession, type Item, type Session, type TurnEntry, textOf } from "@alwith/api"

export type WorkEntry =
  | { kind: "activity"; key: string; items: Array<MessageItem | ToolItem> }
  | { kind: "text"; key: string; item: MessageItem }
  | { kind: "plan"; key: string; item: PlanItem }
  | { kind: "compaction"; key: string; item: CompactionItem }

export type Turn = {
  key: string
  user: MessageItem | null
  work: WorkEntry[]
  final: MessageItem[]
  edits: ToolItem[]
  startedAt: number
  /** When the turn ended (the idle frame); while it is still running, the latest arrival. */
  endedAt: number
  replayed: boolean
  /** Every item that fed this turn, in order. Items are immutable, so two turns built
   *  from the same item references are the same turn (see `groupTurns`). */
  items: Item[]
}

export function isMcpStartup(item: Item): item is ToolItem {
  return item.kind === "tool" && item.name === "mcp_startup"
}

function phase(item: MessageItem): string | null {
  const codex = item._meta?.codex
  if (typeof codex !== "object" || codex === null) return null
  const value = (codex as { phase?: unknown }).phase
  return typeof value === "string" ? value : null
}

function isNotice(item: MessageItem): boolean {
  const codex = item._meta?.codex
  return typeof codex === "object" && codex !== null && (codex as { notice?: unknown }).notice === true
}

/** Lifecycle diagnostics arriving before a prompt are session status, not an agent turn. */
export function isSessionStatus(turn: Turn): boolean {
  return (
    turn.user === null && turn.items.length > 0 && turn.items.every(item => item.kind === "assistant" && isNotice(item))
  )
}

function pushActivity(turn: Turn, item: MessageItem | ToolItem): void {
  const last = turn.work.at(-1)
  if (last?.kind === "activity") {
    last.items.push(item)
    return
  }
  turn.work.push({
    kind: "activity",
    key: `activity:${item.kind}:${item.id}`,
    items: [item]
  })
}

/** A tool and, after it, the steps it dispatched (Codex has none today; the shape is the protocol's). */
function flatten(entry: TurnEntry, out: Item[], tools: ReadonlyMap<string, ToolItem>): void {
  if (entry.kind !== "tool") {
    out.push(entry)
    return
  }
  // The shared grouper clones tools to attach children. Compare/render the immutable
  // session item, not that fresh tree wrapper, so untouched turns remain memoizable.
  const item = tools.get(entry.id)
  if (item === undefined) throw new Error(`Grouped tool is missing from the session: ${entry.id}`)
  out.push(item)
  for (const child of entry.children) flatten(child, out, tools)
}

function place(turn: Turn, item: Item): void {
  switch (item.kind) {
    case "user":
      break
    case "assistant": {
      const itemPhase = phase(item)
      if (itemPhase === "final_answer") turn.final.push(item)
      else if (itemPhase === "commentary" || isNotice(item))
        turn.work.push({ kind: "text", key: `text:${item.id}`, item })
      else turn.final.push(item)
      break
    }
    case "thought":
      pushActivity(turn, item)
      break
    case "tool":
      pushActivity(turn, item)
      if (item.toolKind === "edit") turn.edits.push(item)
      break
    case "plan":
      turn.work.push({ kind: "plan", key: `plan:${item.id}`, item })
      break
    case "compaction":
      turn.work.push({ kind: "compaction", key: `compaction:${item.id}`, item })
      break
  }
}

/**
 * Groups the session into turns. `previous` is the last result for the same session: a turn
 * whose items are all the same references as before is returned as the same object, so
 * memoised turn components and the virtualizer's measurements skip untouched turns while
 * one streams.
 */
export function groupTurns(session: Session, previous: Turn[] = []): Turn[] {
  const tools = new Map(
    session.items.filter((item): item is ToolItem => item.kind === "tool").map(item => [item.id, item])
  )
  // Filter the view before grouping so startup-only entries never create empty turns.
  // Runtime remains the authority for the original diagnostics.
  const visible = { ...session, items: session.items.filter(item => !isMcpStartup(item)) }
  const result: Turn[] = groupSession(visible).map(grouped => {
    const items: Item[] = grouped.prompt === null ? [] : [grouped.prompt]
    for (const entry of grouped.entries) flatten(entry, items, tools)
    const first = items[0]
    if (first === undefined) throw new Error("A turn without items")
    const turn: Turn = {
      key: `turn:${first.kind}:${first.id}`,
      user: grouped.prompt,
      work: [],
      final: [],
      edits: [],
      startedAt: grouped.startedAt ?? first.at,
      endedAt: grouped.endedAt ?? Math.max(...items.map(item => item.at)),
      replayed: items.every(item => item.replayed),
      items
    }
    for (const item of items) place(turn, item)
    return turn
  })
  if (previous.length === 0) return result
  const previousByKey = new Map(previous.map(turn => [turn.key, turn]))
  return result.map(turn => {
    const before = previousByKey.get(turn.key)
    return before !== undefined && sameItems(before.items, turn.items) && before.endedAt === turn.endedAt
      ? before
      : turn
  })
}

function sameItems(a: Item[], b: Item[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index])
}

export function messageText(item: MessageItem): string {
  return textOf(item.content)
}
