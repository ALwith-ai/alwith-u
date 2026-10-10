/** Read-only export over codex-acp-v2's versioned history extension, without session/resume. */
export interface HistoryRequest {
  sessionId: string
  mode: "export"
  sortDirection: "asc"
  cursor?: string
  limit: number
  maxBytes: number
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid history response")
  return value as Record<string, unknown>
}

/** Dialogue-only JSONL, matching the legacy archive's user/assistant record contract. */
export async function exportConversation(
  sessionId: string,
  request: (params: HistoryRequest) => Promise<unknown>,
  check: () => void
): Promise<string> {
  const lines: string[] = []
  const cursors = new Set<string>()
  const items = new Set<string>()
  const encoder = new TextEncoder()
  let cursor: string | undefined
  let revision: string | undefined
  let bytes = 0
  let limit = 50
  while (true) {
    check()
    let raw: unknown
    try {
      raw = await request({
        sessionId,
        mode: "export",
        sortDirection: "asc",
        cursor,
        limit,
        maxBytes: 16 * 1024 * 1024
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
    const page = object(raw)
    if (
      page.sessionId !== sessionId ||
      page.consistency !== "optimistic" ||
      (page.running !== false && page.running !== null) ||
      typeof page.revision !== "string" ||
      !page.revision ||
      !Array.isArray(page.items) ||
      typeof page.createdAt !== "number" ||
      !Number.isFinite(page.createdAt) ||
      (page.nextCursor !== null && (typeof page.nextCursor !== "string" || !page.nextCursor)) ||
      page.complete !== (page.nextCursor === null)
    )
      throw new Error("Invalid or incomplete history export")
    if (revision !== undefined && revision !== page.revision)
      throw new Error("History changed during export; retry when idle")
    revision = page.revision
    if (page.nextCursor !== null && page.items.length === 0) throw new Error("History pagination made no progress")
    for (const rawItem of page.items) {
      const item = object(rawItem)
      if (typeof item.itemId !== "string" || typeof item.turnId !== "string" || !Array.isArray(item.updates))
        throw new Error("Invalid history item")
      const identity = JSON.stringify([item.turnId, item.itemId])
      if (items.has(identity)) throw new Error("History returned a duplicate item")
      items.add(identity)
      const timestamp = item.startedAtMs == null ? page.createdAt * 1000 : item.startedAtMs
      if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) throw new Error("Invalid history timestamp")
      for (const rawUpdate of item.updates) {
        const update = object(rawUpdate)
        if (update.sessionUpdate !== "user_message" && update.sessionUpdate !== "agent_message") continue
        if (!Array.isArray(update.content)) throw new Error("Invalid history message")
        const content: { type: "text"; text: string }[] = []
        for (const rawBlock of update.content) {
          const block = object(rawBlock)
          if (block.type === "text" && typeof block.text === "string") content.push({ type: "text", text: block.text })
          else if (block.type === "resource_link" && typeof block.uri === "string")
            content.push({
              type: "text",
              text: `[${typeof block.name === "string" ? block.name : "Resource"}] ${block.uri}`
            })
          else throw new Error("Unsupported history message content; refusing a partial archive")
        }
        if (!content.length) continue
        const type = update.sessionUpdate === "user_message" ? "user" : "assistant"
        const line = `${JSON.stringify({
          type,
          sessionId,
          uuid: update.messageId ?? item.itemId,
          turnId: item.turnId,
          timestamp: new Date(timestamp).toISOString(),
          message: { role: type, content }
        })}\n`
        bytes += encoder.encode(line).length
        if (bytes > 25 * 1024 * 1024) throw new Error("会话归档超过 25 MiB，请缩小会话后重试")
        lines.push(line)
      }
    }
    cursor = page.nextCursor === null ? undefined : (page.nextCursor as string)
    if (cursor !== undefined) {
      if (cursors.has(cursor)) throw new Error("History returned a repeated cursor")
      cursors.add(cursor)
    }
    if (cursor === undefined) break
  }
  check()
  return lines.join("")
}
