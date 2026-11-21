import { randomUUID } from "node:crypto"

import { CHUNK, ContentCache, TTL } from "./cache"
import { array, NativeBudgetError, NativeError, NativeHistory, object, type ObjectValue, string } from "./native"
import { project } from "./projection"

type Trail = { value: string; previous?: Trail }
type LegacyPosition = { snapshotId: string; index: number; nextId: string; previousId?: string; durationMs?: number }
type Position = { turnCursor?: string; turnId?: string; itemCursor?: string; legacy?: LegacyPosition; trail?: Trail }
type LegacyTurn = { turnId: string; older?: string; items: ObjectValue[]; bytes: number; expires: number }
const MAX_LEGACY_BYTES = 64 * 1024 * 1024
const MAX_LEGACY_TURNS = 64
type Page = { sessionId: string; lines: string[]; nextCursor: string | null }

function advance(trail: Trail | undefined, value: string): Trail {
  for (let node = trail; node; node = node.previous) if (node.value === value) throw new Error("History cursor cycle")
  return { value, previous: trail }
}

function next(value: unknown): string | undefined {
  return value === null ? undefined : string(value)
}

function turnDuration(turn: ObjectValue): number | undefined {
  const { durationMs, startedAt, completedAt } = turn
  const value =
    durationMs ??
    (typeof startedAt === "number" && typeof completedAt === "number" && startedAt >= 0
      ? (completedAt - startedAt) * 1000
      : undefined)
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function frame(sessionId: string, update: ObjectValue, durationMs: number | undefined): string {
  if (durationMs !== undefined) {
    const meta = object(update._meta)
    update = { ...update, _meta: { ...meta, codex: { ...object(meta.codex), turnDurationMs: durationMs } } }
  }
  return JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update } })
}

function unavailable(sessionId: string, turnId: string, durationMs: number | undefined, itemId?: string): string {
  const messageId = itemId ? "history-size:item:" + turnId + ":" + itemId : "history-size:turn:" + turnId
  const text = itemId
    ? "This history item exceeds the 64 MiB reading limit."
    : "Codex could not return this turn within the 64 MiB reading limit."
  return frame(
    sessionId,
    {
      sessionUpdate: "agent_message",
      messageId,
      content: [{ type: "text", text }],
      _meta: { codex: { turnId, historyItemId: itemId ?? messageId, historyError: "history_size_limit" } }
    },
    durationMs
  )
}

// Replace only ACP image blocks. Terminal output, audio and ordinary tool data stay in the body.
function extractImages(value: unknown, images: ObjectValue[]): unknown {
  if (Array.isArray(value)) return value.map((entry) => extractImages(entry, images))
  if (!value || typeof value !== "object") return value
  const block = value as ObjectValue
  if (block.type === "image" && typeof block.data === "string") {
    images.push(block)
    return { type: "text", text: "" }
  }
  return Object.fromEntries(Object.entries(block).map(([key, child]) => [key, extractImages(child, images)]))
}

export class HistoryPages {
  private cursors = new Map<string, { sessionId: string; position: Position; expires: number }>()
  private legacyTurns = new Map<string, LegacyTurn>()
  private legacyBytes = 0
  private readonly native: Pick<NativeHistory, "read">
  private readonly cache: ContentCache
  constructor(native: Pick<NativeHistory, "read">, cache: ContentCache) {
    this.native = native
    this.cache = cache
  }

  prune(): void {
    const now = Date.now()
    for (const [id, cursor] of this.cursors) if (cursor.expires <= now) this.cursors.delete(id)
    for (const [id, turn] of this.legacyTurns) if (turn.expires <= now) this.forgetLegacyTurn(id, turn)
  }

  private forgetLegacyTurn(id: string, turn: LegacyTurn): void {
    this.legacyTurns.delete(id)
    this.legacyBytes -= turn.bytes
  }

  private rememberLegacyTurn(turnId: string, older: string | undefined, items: ObjectValue[]): string {
    const bytes = Buffer.byteLength(JSON.stringify(items))
    if (bytes > MAX_LEGACY_BYTES) throw new Error("Mobile history turn exceeds snapshot budget")
    for (const [id, turn] of this.legacyTurns) {
      if (this.legacyBytes + bytes <= MAX_LEGACY_BYTES && this.legacyTurns.size < MAX_LEGACY_TURNS) break
      this.forgetLegacyTurn(id, turn)
    }
    const id = randomUUID()
    this.legacyTurns.set(id, { turnId, older, items, bytes, expires: Date.now() + TTL })
    this.legacyBytes += bytes
    return id
  }

  private async readLegacyTurn(sessionId: string, turnCursor: string | undefined, turnId: string, signal: AbortSignal) {
    const full = await this.native.read(
      "thread/turns/list",
      {
        threadId: sessionId,
        cursor: turnCursor,
        sortDirection: "desc",
        limit: 1,
        itemsView: "full"
      },
      signal
    )
    const turns = array(full.data)
    if (turns.length !== 1 || object(turns[0]).id !== turnId) throw new Error("history_cursor_expired: turn changed")
    const turn = object(turns[0])
    const items = array(turn.items).map(object).reverse()
    if (new Set(items.map((item) => string(item.id))).size !== items.length)
      throw new Error("Duplicate history item identity")
    return { items, older: next(full.nextCursor), durationMs: turnDuration(turn) }
  }

  private cursor(sessionId: string, position: Position): string {
    if (this.cursors.size >= 4096) this.cursors.delete(this.cursors.keys().next().value!)
    const id = randomUUID()
    const expires = Date.now() + TTL
    if (position.legacy) {
      // A new continuation can outlive the earlier cursors for this snapshot.
      const snapshot = this.legacyTurns.get(position.legacy.snapshotId)
      if (snapshot) snapshot.expires = expires
    }
    this.cursors.set(id, { sessionId, position, expires })
    return id
  }

  async read(sessionId: string, cursor: unknown, budget: number, signal: AbortSignal): Promise<Page> {
    if (!Number.isInteger(budget) || budget < 1024 || budget > 2 * 1024 * 1024)
      throw new Error("Invalid history page budget")
    const page = await this.readOne(sessionId, cursor, budget, signal)
    const started = Date.now()
    // Stay inside the same turn; bound time and work per phone request.
    for (let n = 1; n < 8 && page.nextCursor && Date.now() - started < 300; n++) {
      if (budget < 128 * 1024 || !this.cursors.get(page.nextCursor)?.position.turnId) break
      const more = await this.readOne(sessionId, page.nextCursor, budget, signal)
      const lines = [...more.lines, ...page.lines]
      if (Buffer.byteLength(JSON.stringify({ ...page, lines, nextCursor: more.nextCursor })) > budget) break
      page.lines = lines
      page.nextCursor = more.nextCursor
    }
    if (page.lines.length && (!page.nextCursor || !this.cursors.get(page.nextCursor)?.position.turnId)) {
      const first = JSON.parse(page.lines[0])
      first.params.update._meta.codex.historyTurnStart = true
      const marked = JSON.stringify(first)
      const lines = [marked, ...page.lines.slice(1)]
      if (Buffer.byteLength(JSON.stringify({ ...page, lines })) <= budget) page.lines = lines
    }
    return page
  }

  private async readOne(sessionId: string, cursor: unknown, budget: number, signal: AbortSignal): Promise<Page> {
    this.prune()
    let position: Position = {}
    if (cursor != null) {
      const entry = this.cursors.get(string(cursor))
      if (!entry || entry.sessionId !== sessionId) throw new Error("history_cursor_expired: reload history")
      position = entry.position
    }
    const page: Page = { sessionId, lines: [], nextCursor: null }
    while (true) {
      signal.throwIfAborted()
      const params = { threadId: sessionId, cursor: position.turnCursor, sortDirection: "desc", limit: 1 }
      const saved = position.legacy
      let turnId: string
      let older: string | undefined
      let durationMs: number | undefined
      let entries: ObjectValue[] = []
      let itemCursor: string | undefined
      let legacy = false
      let firstItem = saved?.index ?? 0
      let snapshotId: string | undefined
      if (saved && position.turnId) {
        const snapshot = this.legacyTurns.get(saved.snapshotId)
        turnId = position.turnId
        const turn = snapshot ?? (await this.readLegacyTurn(sessionId, position.turnCursor, turnId, signal))
        older = turn.older
        durationMs = saved.durationMs
        entries = turn.items
        if (snapshot) snapshotId = saved.snapshotId
        else {
          firstItem = entries.findIndex((item) => item.id === saved.nextId)
          if (firstItem < 0 || (saved.previousId !== undefined && entries[firstItem - 1]?.id !== saved.previousId))
            throw new Error("history_cursor_expired: item boundary changed")
        }
        legacy = true
      } else {
        const summary = await this.native.read("thread/turns/list", { ...params, itemsView: "summary" }, signal)
        const turns = array(summary.data)
        older = next(summary.nextCursor)
        if (turns.length === 0 && !older && !position.turnId) return page
        if (turns.length !== 1) throw new Error("Invalid native turn pagination")
        const turn = object(turns[0])
        turnId = string(turn.id)
        durationMs = turnDuration(turn)
        if (position.turnId && position.turnId !== turnId) throw new Error("history_cursor_expired: turn changed")
        if (!position.turnId && turn.error) {
          const itemId = "codex-error:" + turnId
          const item = { id: itemId, type: "agentMessage", text: string(object(turn.error).message) }
          page.lines.push(...(await this.lines(sessionId, item, turnId, durationMs, budget, signal)))
        }
        try {
          const response = await this.native.read(
            "thread/items/list",
            {
              threadId: sessionId,
              turnId,
              cursor: position.itemCursor,
              limit: 1,
              sortDirection: "desc",
              deferOutput: { commandExecution: true, mcpToolCall: true }
            },
            signal
          )
          const records = array(response.data)
          itemCursor = next(response.nextCursor)
          if (records.length > 1 || (!records.length && itemCursor)) throw new Error("Invalid native item pagination")
          for (const value of records) {
            const entry = object(value)
            if (entry.turnId !== turnId) throw new Error("Unexpected native item turn")
            const item = object(entry.item)
            if (entry.outputDeferred !== true) {
              entries.push(
                item.type === "reasoning"
                  ? {
                      ...item,
                      startedAtMs: entry.startedAtMs ?? item.startedAtMs,
                      completedAtMs: entry.completedAtMs ?? item.completedAtMs
                    }
                  : item
              )
              continue
            }
            const id = string(item.id)
            try {
              const full = await this.native.read(
                "thread/items/read",
                { threadId: sessionId, turnId, itemIds: [id] },
                signal
              )
              const data = array(full.data)
              if (data.length !== 1 || object(data[0]).turnId !== turnId || object(data[0]).outputDeferred === true)
                throw new Error("Invalid deferred history response")
              const complete = object(object(data[0]).item)
              if (complete.id !== id) throw new Error("Unexpected deferred history identity")
              entries.push(complete)
            } catch (error) {
              if (!(error instanceof NativeBudgetError)) throw error
              page.lines.unshift(unavailable(sessionId, turnId, durationMs, id))
            }
          }
        } catch (error) {
          if (error instanceof NativeBudgetError) {
            // Non-deferrable native items can exhaust the limit before Codex returns an item ID or cursor.
            page.lines.unshift(unavailable(sessionId, turnId, durationMs))
          } else if (
            error instanceof NativeError &&
            (error.code === -32601 || (error.code === -32600 && /legacy|not supported/i.test(error.message)))
          ) {
            try {
              const full = await this.readLegacyTurn(sessionId, position.turnCursor, turnId, signal)
              entries = full.items
              durationMs = full.durationMs ?? durationMs
              legacy = true
            } catch (fullError) {
              if (!(fullError instanceof NativeBudgetError)) throw fullError
              page.lines.unshift(unavailable(sessionId, turnId, durationMs))
            }
          } else throw error
        }
      }
      const trail = position.turnId ? position.trail : advance(position.trail, "turn:" + turnId)
      const continueTurn = (index: number): string => {
        const nextPosition = { ...position, turnId, trail }
        if (legacy) {
          snapshotId ??= this.rememberLegacyTurn(turnId, older, entries)
          nextPosition.legacy = {
            snapshotId,
            index,
            durationMs,
            nextId: string(entries[index].id),
            previousId: index > 0 ? string(entries[index - 1].id) : undefined
          }
        }
        return this.cursor(sessionId, nextPosition)
      }
      let consumed = 0
      for (let index = firstItem; index < entries.length; index++) {
        const item = entries[index]
        signal.throwIfAborted()
        const lines = await this.lines(sessionId, item, turnId, durationMs, budget, signal)
        const proposed = [...lines, ...page.lines]
        if (Buffer.byteLength(JSON.stringify({ ...page, lines: proposed, nextCursor: "0".repeat(36) })) > budget) {
          if (!consumed && page.lines.length) {
            page.nextCursor = continueTurn(firstItem)
            if (Buffer.byteLength(JSON.stringify(page)) <= budget) return page
          }
          if (!consumed) throw new Error("History item or diagnostic exceeds page budget")
          break
        }
        page.lines = proposed
        consumed++
        if (consumed === 20) break
      }
      signal.throwIfAborted()
      const nextItem = firstItem + consumed
      if (legacy && nextItem < entries.length) {
        page.nextCursor = continueTurn(nextItem)
      } else if (itemCursor) {
        page.nextCursor = this.cursor(sessionId, {
          ...position,
          turnId,
          itemCursor,
          trail: advance(trail, turnId + ":item:" + itemCursor)
        })
      } else if (older) {
        position = { turnCursor: older, trail: advance(trail, "native:" + older) }
        if (!page.lines.length) continue
        page.nextCursor = this.cursor(sessionId, position)
      }
      if (Buffer.byteLength(JSON.stringify(page)) > budget) throw new Error("History page exceeds budget")
      return page
    }
  }

  private async lines(
    sessionId: string,
    item: ObjectValue,
    turnId: string,
    durationMs: number | undefined,
    budget: number,
    signal: AbortSignal
  ): Promise<string[]> {
    const role = item.type === "userMessage" ? "user" : "assistant"
    const images: ObjectValue[] = []
    const updates = project(item, turnId).map((update) => extractImages(update, images) as ObjectValue)
    const kind = ["agentMessage", "userMessage", "reasoning", "plan"].includes(String(item.type)) ? "text" : "tool"
    const body = await this.encode(sessionId, item, turnId, role, kind, updates, durationMs, budget, signal)
    if (!images.length) return body

    const id = "history-images:" + string(item.id)
    const group = {
      sessionUpdate: role === "user" ? "user_message" : "agent_message",
      messageId: id,
      content: images,
      _meta: { codex: { historyItemId: id, turnId } }
    }
    const attachments = await this.encode(
      sessionId,
      { type: "image", id },
      turnId,
      role,
      "image",
      [group],
      durationMs,
      budget,
      signal
    )
    return [...body, ...attachments]
  }

  private async encode(
    sessionId: string,
    item: ObjectValue,
    turnId: string,
    role: string,
    kind: string,
    updates: ObjectValue[],
    durationMs: number | undefined,
    budget: number,
    signal: AbortSignal
  ): Promise<string[]> {
    const bytes = Buffer.from(JSON.stringify(updates))
    if (bytes.length > 64 * 1024 * 1024) {
      if (kind !== "image") return [unavailable(sessionId, turnId, durationMs, string(item.id))]
      return [frame(sessionId, { ...updates[0], content: [{ type: "image", mimeType: "image/png" }] }, durationMs)]
    }
    if (kind !== "image" && bytes.length <= CHUNK && bytes.length < budget / 2) {
      const lines = updates.map((update) => frame(sessionId, update, durationMs))
      if (Buffer.byteLength(JSON.stringify(lines)) < budget - 256) return lines
    }
    const preview = String(item.text ?? item.command ?? item.tool ?? item.type).slice(
      0,
      Math.min(1024, Math.floor(budget / 16))
    )
    const reference = {
      ...(await this.cache.save(sessionId, bytes, signal)),
      itemId: item.id,
      turnId,
      role,
      kind,
      preview,
      entityId: updates[0]?.messageId ?? updates[0]?.toolCallId ?? item.id
    }
    return [
      frame(
        sessionId,
        {
          sessionUpdate: role === "user" ? "user_message" : "agent_message",
          messageId: "history-content:" + reference.contentId,
          content: [{ type: "text", text: preview }],
          _meta: {
            codex: {
              ...(item.type === "reasoning" ? { ...object(object(updates[0]._meta).codex), historyThought: true } : {}),
              historyItemId: item.id,
              historyContent: reference
            }
          }
        },
        durationMs
      )
    ]
  }
}
