import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, expect, it, vi } from "vitest"

import { ContentCache, TTL } from "../cache"
import { NativeBudgetError, NativeError, type ObjectValue } from "../native"
import { HistoryPages } from "../pages"
import { project } from "../projection"

const cache = new ContentCache()
const signal = new AbortController().signal
afterEach(() => {
  cache.close()
  vi.restoreAllMocks()
})

it("matches the published ACP entity identities and selects the display reasoning", () => {
  const user = { type: "userMessage", id: "native", content: [{ type: "text", text: "hello" }] }
  expect(project({ ...user, clientId: "steer" }, "turn")[0]).toMatchObject({
    messageId: "steer",
    _meta: { codex: { historyItemId: "native" } }
  })
  expect(project({ ...user, clientId: "  " }, "turn")[0].messageId).toBe("native")
  expect(project({ type: "agentMessage", id: "agent", text: "answer" }, "turn")[0].messageId).toBe("agent")
  expect(
    project({ type: "reasoning", id: "r", summary: ["display"], content: ["duplicate"] }, "turn")[0]
  ).toMatchObject({ sessionUpdate: "agent_thought", messageId: "r", content: [] })
  expect(project({ type: "plan", id: "p", text: "steps" }, "turn")[0].plan).toEqual({
    type: "markdown",
    planId: "p",
    content: "steps"
  })
})

it("renders native question replies as readable history and preserves ordinary text", () => {
  const reply = { questionItemId: "q", question: "Where?", answer: "  Remote  " }
  const envelope =
    "<send_user_message_question_reply>\n" + JSON.stringify([reply]) + "\n</send_user_message_question_reply>"
  const content = (text: string) =>
    project({ type: "userMessage", id: "r", content: [{ type: "text", text }] }, "t")[0]!.content
  expect(content(envelope)).toEqual([{ type: "text", text: "Where?\n  Remote  " }])
  expect(content("Example: " + envelope)).toEqual([{ type: "text", text: "Example: " + envelope }])
})

it("preserves async question titles and options in the mobile history page", () => {
  const questions = [
    { title: "Choose a destination", options: ["Local", "Remote"] },
    { title: "Any details?", options: null }
  ]
  const text = "Choose a destination\n- Local\n- Remote\n\nAny details?"
  const [message] = project({ type: "agentMessage", id: "q", text, delivery: "async", questions }, "turn")
  expect(message).toMatchObject({
    sessionUpdate: "agent_message",
    messageId: "q",
    content: [{ type: "text", text }],
    _meta: { codex: { delivery: "async", questions, phase: "final_answer" } }
  })
})

it.each([
  { legacy: false, timing: { durationMs: 36284, startedAt: 1, completedAt: 37 }, expected: 36284 },
  { legacy: true, timing: { durationMs: null, startedAt: 1, completedAt: 37 }, expected: 36000 },
  { legacy: false, timing: { durationMs: null, startedAt: 1, completedAt: null }, expected: undefined },
  { legacy: false, timing: { durationMs: 0 }, expected: 0 }
])("sends native turn timing through mobile pagination ($legacy, $expected)", async ({ legacy, timing, expected }) => {
  const items = [
    { id: "answer", type: "agentMessage", phase: "final_answer", text: "a".repeat(4096) },
    { id: "thought", type: "reasoning", startedAtMs: 1000, completedAtMs: 6100 },
    { id: "question", type: "userMessage", content: [{ type: "text", text: "question" }] }
  ]
  const pages = new HistoryPages(
    {
      async read(method, params) {
        if (method === "thread/turns/list") {
          const full = params.itemsView === "full"
          return {
            data: [{ id: "turn", ...(legacy !== full ? {} : timing), ...(full ? { items: items.toReversed() } : {}) }],
            nextCursor: null
          }
        }
        if (legacy) throw new NativeError(-32601, "unsupported")
        const i = Number(params.cursor ?? 0)
        return { data: [{ turnId: "turn", item: items[i] }], nextCursor: i < 2 ? String(i + 1) : null }
      }
    },
    cache
  )
  let cursor: string | null = null
  const updates = []
  do {
    const page = await pages.read("s", cursor, 1024, signal)
    updates.unshift(...page.lines.map((line) => JSON.parse(line).params.update._meta.codex))
    cursor = page.nextCursor
  } while (cursor)
  expect(updates.map((meta) => meta.turnDurationMs)).toEqual([expected, expected, expected])
  expect(updates[1].reasoningDurationMs).toBe(5100)
})

it("publishes measured reasoning time only for valid item timestamps", () => {
  const thought = { type: "reasoning", id: "r", summary: [], content: [], startedAtMs: 100 }
  expect(project({ ...thought, completedAtMs: 4861 }, "t")[0]._meta).toEqual({
    codex: { historyItemId: "r", turnId: "t", reasoningDurationMs: 4761 }
  })
  for (const completedAtMs of [null, 99]) {
    expect(project({ ...thought, completedAtMs }, "t")[0]._meta).toEqual({ codex: { historyItemId: "r", turnId: "t" } })
  }
})

it("retains terminal, diff and MCP media payloads without opening paths", () => {
  const [tool, terminal] = project(
    {
      type: "commandExecution",
      id: "cmd",
      processId: "pty",
      command: "pwd",
      cwd: "/work",
      exitCode: 0,
      aggregatedOutput: "complete"
    },
    "t"
  )
  expect(tool).toMatchObject({ toolCallId: "cmd", content: [{ type: "terminal", terminalId: "cmd" }] })
  expect(terminal).toMatchObject({ terminalId: "cmd", output: { data: Buffer.from("complete").toString("base64") } })
  expect(project({ type: "fileChange", id: "f", changes: [{ path: "x", diff: "patch" }] }, "t")[0].content).toEqual([
    { type: "diff", path: "x", patch: { text: "patch" } }
  ])
  const media = { content: [{ type: "image", mimeType: "image/png", data: "AQ==" }] }
  expect(project({ type: "mcpToolCall", id: "m", server: "test", tool: "image", result: media }, "t")[0]).toMatchObject(
    { toolCallId: "m", rawOutput: { result: media } }
  )
})

it("binds page cursors to a session and keeps an empty failed turn", async () => {
  const calls: string[] = []
  const pages = new HistoryPages(
    {
      async read(method, params) {
        calls.push(method)
        const older = !!params.cursor
        if (method === "thread/items/list") throw new NativeError(-32601, "unsupported")
        return {
          data: [
            {
              id: older ? "old" : "failed",
              items: older ? [{ id: "u", type: "userMessage", content: [{ type: "text", text: "old" }] }] : [],
              error: older ? null : { message: "declined" }
            }
          ],
          nextCursor: older ? null : "next"
        }
      }
    },
    cache
  )
  const recent = await pages.read("s", null, 2048, signal)
  expect(JSON.parse(recent.lines[0]).params.update.messageId).toBe("codex-error:failed")
  await expect(pages.read("other", recent.nextCursor, 2048, signal)).rejects.toThrow("expired")
  const old = await pages.read("s", recent.nextCursor, 2048, signal)
  expect(JSON.parse(old.lines[0]).params.update.messageId).toBe("u")
  expect(old.nextCursor).toBeNull()
  expect(calls.filter((x) => x === "thread/items/list")).toHaveLength(2)
})

it("continues paging after a failed image generation without an artifact", async () => {
  const pages = new HistoryPages(
    {
      async read(method, params) {
        if (method === "thread/turns/list") {
          return params.cursor
            ? { data: [{ id: "older" }], nextCursor: null }
            : { data: [{ id: "latest" }], nextCursor: "older-turn" }
        }
        const item =
          params.turnId === "latest"
            ? {
                type: "imageGeneration",
                id: "image",
                status: "failed",
                revisedPrompt: null,
                result: "",
                failure: { reason: "policy" }
              }
            : { type: "agentMessage", id: "answer", text: "Earlier answer" }
        return { data: [{ turnId: params.turnId, item }], nextCursor: null }
      }
    },
    cache
  )
  const latest = await pages.read("s", null, 2048, signal)
  expect(latest.lines).toHaveLength(1)
  const { update } = JSON.parse(latest.lines[0]!).params
  expect(update).toMatchObject({
    sessionUpdate: "tool_call",
    toolCallId: "image",
    status: "failed",
    content: [],
    rawOutput: { failure: { reason: "policy" } },
    _meta: { codex: { turnId: "latest" } }
  })
  expect(update._meta.codex).not.toHaveProperty("historyContent")
  expect(latest.nextCursor).toEqual(expect.any(String))

  const older = await pages.read("s", latest.nextCursor, 2048, signal)
  expect(JSON.parse(older.lines[0]!).params.update).toMatchObject({
    messageId: "answer",
    content: [{ type: "text", text: "Earlier answer" }]
  })
  expect(older.nextCursor).toBeNull()
})

it("keeps image generation in progress while waiting for an artifact", () => {
  const [update] = project(
    { type: "imageGeneration", id: "image", status: "generating", result: "", failure: null },
    "turn"
  )
  expect(update).toMatchObject({ toolCallId: "image", status: "in_progress", content: [] })
})

it("preserves completed image data and saved image links", () => {
  const item = { type: "imageGeneration", id: "image", status: "completed", savedPath: "/tmp/image.png" }
  expect(project({ ...item, result: "AQID" }, "turn")[0]!.content).toEqual([
    { type: "content", content: { type: "image", mimeType: "image/png", data: "AQID" } }
  ])
  expect(project({ ...item, result: "" }, "turn")[0]!.content).toEqual([
    { type: "content", content: { type: "resource_link", name: "Image", uri: "/tmp/image.png" } }
  ])
})

it("rejects a native cursor cycle and prefers per-turn item pagination", async () => {
  const pages = new HistoryPages(
    {
      async read(method, params): Promise<ObjectValue> {
        if (method === "thread/turns/list") {
          expect(params.itemsView).toBe("summary")
          return { data: [{ id: "turn" }], nextCursor: null }
        }
        expect(params.turnId).toBe("turn")
        return { data: [{ turnId: "turn", item: { type: "agentMessage", id: "a", text: "hi" } }], nextCursor: "loop" }
      }
    },
    cache
  )
  const first = await pages.read("s", null, 2048, signal)
  await expect(pages.read("s", first.nextCursor, 2048, signal)).rejects.toThrow("cycle")
})

it("verifies unaligned content ranges, session binding and fixed expiry", async () => {
  const bytes = Buffer.from("多".repeat(200000))
  const ref = await cache.save("s", bytes, signal)
  const block = cache.read("s", ref.contentId, 262143, 7)
  expect(Buffer.from(block.data, "base64")).toEqual(bytes.subarray(262143, 262150))
  expect(block.isLast).toBe(false)
  expect(() => cache.read("other", ref.contentId, 0, 1)).toThrow("expired")
  expect(() => cache.read("s", ref.contentId, bytes.length, 1)).toThrow("range")
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + TTL + 1)
  expect(() => cache.read("s", ref.contentId, 0, 1)).toThrow("expired")
})

it("isolates a deferred oversized item and continues with the older item in the same turn", async () => {
  const pages = new HistoryPages(
    {
      async read(method, params) {
        if (method === "thread/turns/list") return { data: [{ id: "turn" }], nextCursor: null }
        if (method === "thread/items/read") {
          expect(params.itemIds).toEqual(["big"])
          throw new NativeBudgetError()
        }
        expect(params.deferOutput).toEqual({ commandExecution: true, mcpToolCall: true })
        return params.cursor
          ? { data: [{ turnId: "turn", item: { id: "ok", type: "agentMessage", text: "older" } }], nextCursor: null }
          : { data: [{ turnId: "turn", item: { id: "big" }, outputDeferred: true }], nextCursor: "older" }
      }
    },
    cache
  )
  const recent = await pages.read("s", null, 2 * 1024 * 1024, signal)
  const updates = recent.lines.map((line) => JSON.parse(line).params.update)
  expect(updates.find((u) => u._meta.codex.historyItemId === "big")._meta.codex.historyError).toBe("history_size_limit")
  const all = recent.nextCursor
    ? [...recent.lines, ...(await pages.read("s", recent.nextCursor, 2 * 1024 * 1024, signal)).lines]
    : recent.lines
  expect(all.some((line) => line.includes("older"))).toBe(true)
})

it("continues past a legacy unidentifiable oversized turn", async () => {
  const pages = new HistoryPages(
    {
      async read(method, params) {
        if (method === "thread/items/list") throw new NativeError(-32601, "unsupported")
        if (params.itemsView === "full" && !params.cursor) throw new NativeBudgetError()
        return params.cursor
          ? { data: [{ id: "good", items: [{ id: "before", type: "agentMessage", text: "older" }] }], nextCursor: null }
          : { data: [{ id: "big" }], nextCursor: "before" }
      }
    },
    cache
  )
  const recent = await pages.read("s", null, 2 * 1024 * 1024, signal)
  expect(JSON.parse(recent.lines[0]).params.update.messageId).toBe("history-size:turn:big")
  expect((await pages.read("s", recent.nextCursor, 2 * 1024 * 1024, signal)).lines[0]).toContain("older")
})

it("keeps items above 256 KiB behind a reference even with a 2 MiB page", async () => {
  const text = "a".repeat(256 * 1024 + 1)
  const pages = new HistoryPages(
    {
      async read(method) {
        if (method === "thread/turns/list") return { data: [{ id: "turn" }], nextCursor: null }
        return { data: [{ turnId: "turn", item: { id: "a", type: "agentMessage", text } }], nextCursor: null }
      }
    },
    cache
  )
  const page = await pages.read("s", null, 2 * 1024 * 1024, signal)
  expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(8192)
  const ref = JSON.parse(page.lines[0]).params.update._meta.codex.historyContent
  expect(ref.byteLength).toBeGreaterThan(256 * 1024)
  expect(ref.entityId).toBe("a")
})

it("ships the complete image question and final answer without transferring image bytes or commentary", async () => {
  const items = [
    { id: "a", type: "agentMessage", phase: "final_answer", text: "answer" },
    { id: "r", type: "reasoning", summary: ["hidden reasoning"], content: [], startedAtMs: 0, completedAtMs: 4761 },
    { id: "c", type: "agentMessage", phase: "commentary", text: "hidden progress" },
    {
      id: "q",
      type: "userMessage",
      content: [
        { type: "text", text: "full question" },
        { type: "image", url: "data:image/png;base64," + "AQID".repeat(100000) }
      ]
    }
  ]
  const pages = new HistoryPages(
    {
      async read(method, params) {
        if (method === "thread/turns/list") return { data: [{ id: "t" }], nextCursor: "older" }
        const i = Number(params.cursor ?? 0)
        return { data: [{ turnId: "t", item: items[i] }], nextCursor: i + 1 < items.length ? String(i + 1) : null }
      }
    },
    cache
  )
  const lines: string[] = []
  let cursor: string | null = null
  do {
    const page = await pages.read("s", cursor, 2 * 1024 * 1024, signal)
    lines.unshift(...page.lines)
    cursor = page.nextCursor
  } while (cursor && !JSON.parse(lines[0]).params.update._meta.codex.historyTurnStart)
  const wire = lines.join("")
  expect(wire).toContain("full question")
  expect(wire).toContain("final_answer")
  expect(wire).toContain("4761")
  expect(wire).not.toMatch(/hidden reasoning|hidden progress|AQIDAQID/)
  const refs = lines.map((line) => JSON.parse(line).params.update._meta.codex.historyContent).filter(Boolean)
  expect(refs).toHaveLength(1)
  expect(refs[0]).toMatchObject({ kind: "image", role: "user", turnId: "t" })
  expect(cache.read("s", refs[0].contentId, 0, 1024).totalBytes).toBe(refs[0].byteLength)
})

it("defers tool images but leaves adjacent tool output in the turn body", async () => {
  const pages = new HistoryPages(
    {
      async read(method) {
        if (method === "thread/turns/list") return { data: [{ id: "t" }], nextCursor: null }
        return {
          data: [
            {
              turnId: "t",
              item: {
                type: "mcpToolCall",
                id: "tool",
                server: "x",
                tool: "capture",
                result: {
                  content: [
                    { type: "text", text: "tool result" },
                    { type: "image", data: "AQID", mimeType: "image/png" }
                  ]
                }
              }
            }
          ],
          nextCursor: null
        }
      }
    },
    cache
  )
  const page = await pages.read("s", null, 2 * 1024 * 1024, signal)
  const updates = page.lines.map((line) => JSON.parse(line).params.update)
  expect(JSON.stringify(updates)).toContain("tool result")
  expect(JSON.stringify(updates)).not.toContain("AQID")
  const ref = updates[1]._meta.codex.historyContent
  expect(ref.kind).toBe("image")
  const bytes = cache.read("s", ref.contentId, 0, ref.byteLength)
  expect(JSON.parse(Buffer.from(bytes.data, "base64").toString())[0].content[0].data).toBe("AQID")
})

it("delivers session-owned generated image links as downloadable attachments", async () => {
  const home = await mkdtemp(join(tmpdir(), "mobile-generated-"))
  vi.stubEnv("CODEX_HOME", home)
  try {
    const dir = join(home, "generated_images", "s")
    await mkdir(dir, { recursive: true })
    const png = Buffer.from("89504e470d0a1a0a01020304", "hex")
    await writeFile(join(dir, "alwith-call-1.png"), png)
    await symlink(join(dir, "alwith-call-1.png"), join(dir, "alwith-call-3.png"))
    const paths = ["s/alwith-call-1.png", "s/alwith-call-2.png", "s/alwith-call-3.png", "other/alwith-call-1.png"]
    const item = {
      id: "call",
      type: "mcpToolCall",
      server: "alwith",
      tool: "generate_image",
      status: "completed",
      result: {
        content: paths.map((path) => ({
          type: "resource_link",
          uri: "alwith-generated-image:generated_images/" + path
        }))
      }
    }
    const pages = new HistoryPages(
      {
        async read(method) {
          return { data: method === "thread/turns/list" ? [{ id: "t" }] : [{ turnId: "t", item }], nextCursor: null }
        }
      },
      cache
    )
    const page = await pages.read("s", null, 128 * 1024, signal)
    const refs = page.lines.map((line) => JSON.parse(line).params.update._meta.codex.historyContent).filter(Boolean)
    expect(refs).toHaveLength(4)
    const images = refs.map((ref) => {
      expect(ref.kind).toBe("image")
      const chunk = cache.read("s", ref.contentId, 0, ref.byteLength)
      return JSON.parse(Buffer.from(chunk.data, "base64").toString())[0].content[0]
    })
    expect(images[0]).toEqual({ type: "image", mimeType: "image/png", data: png.toString("base64") })
    expect(images.slice(1)).toEqual(Array(3).fill({ type: "image", mimeType: "image/png" }))
  } finally {
    vi.unstubAllEnvs()
    await rm(home, { recursive: true, force: true })
  }
})

it("reuses one native full turn across pages and reads a fresh snapshot on reopen", async () => {
  let fullReads = 0
  const items = Array.from({ length: 60 }, (_, i) => ({
    id: `answer-${i}`,
    type: "agentMessage",
    text: `answer ${i}`
  }))
  const pages = new HistoryPages(
    {
      async read(method, params) {
        if (method === "thread/items/list") throw new NativeError(-32601, "unsupported")
        if (params.itemsView === "summary") return { data: [{ id: "turn" }], nextCursor: null }
        fullReads++
        return { data: [{ id: "turn", items }], nextCursor: null }
      }
    },
    cache
  )

  const first = await pages.read("s", null, 4096, signal)
  expect(first.nextCursor).not.toBeNull()
  const clock = vi.spyOn(Date, "now")
  const started = Date.now()
  const ids: string[] = []
  let page = first
  for (let n = 0; n < 60; n++) {
    ids.unshift(...page.lines.map((line) => JSON.parse(line).params.update.messageId))
    if (page.nextCursor === null) break
    clock.mockReturnValue(started + (n + 1) * (TTL - 100))
    page = await pages.read("s", page.nextCursor, 4096, signal)
  }
  await expect(pages.read("s", first.nextCursor, 4096, signal)).rejects.toThrow("history_cursor_expired")
  expect(page.nextCursor).toBeNull()
  expect(ids).toEqual(items.map((item) => item.id))
  expect(JSON.parse(page.lines[0]).params.update._meta.codex.historyTurnStart).toBe(true)
  expect(fullReads).toBe(1)

  items[59].text = "new answer"
  const reopened = await pages.read("s", null, 4096, signal)
  expect(reopened.lines.at(-1)).toContain("new answer")
  expect(fullReads).toBe(2)
})

it("reads a one-MiB history range across cache block boundaries", async () => {
  const data = Buffer.from("abcdefg".repeat(200000))
  const reference = await cache.save("s", data, signal)
  const chunk = cache.read("s", reference.contentId, 23, 1024 * 1024)
  expect(Buffer.from(chunk.data, "base64")).toEqual(data.subarray(23, 23 + 1024 * 1024))
  expect(chunk.isLast).toBe(false)
  expect(() => cache.read("s", reference.contentId, 0, 1024 * 1024 + 1)).toThrow("Invalid content range")
})

it("resumes an evicted legacy turn from the next unread item", async () => {
  const padding = "x".repeat(33 * 1024 * 1024)
  const items = Array.from({ length: 400 }, (_, i) => ({
    id: "answer-" + i,
    type: "agentMessage",
    phase: i === 0 ? "commentary" : "final_answer",
    text: i === 0 ? padding : "answer"
  }))
  let current = items.slice()
  const fullReads: string[] = []
  const pages = new HistoryPages(
    {
      async read(method, params) {
        if (method === "thread/items/list") throw new NativeError(-32601, "unsupported")
        if (params.itemsView === "summary") return { data: [{ id: "turn" }], nextCursor: null }
        fullReads.push(String(params.threadId))
        return { data: [{ id: "turn", items: current }], nextCursor: null }
      }
    },
    cache
  )
  const read = (session: string, cursor: string | null) => pages.read(session, cursor, 2 * 1024 * 1024, signal)
  const first = await read("a", null)
  const second = await read("a", first.nextCursor)
  expect(second.nextCursor).not.toBeNull()
  await read("b", null)
  current = [...items, { ...items[1], id: "newer" }]
  let page = second
  const ids = (lines: string[]) => lines.map((line) => JSON.parse(line).params.update.messageId)
  const received = [...ids(second.lines), ...ids(first.lines)]
  while (page.nextCursor) {
    page = await read("a", page.nextCursor)
    received.unshift(...ids(page.lines))
  }
  expect(received).toEqual(items.map((item) => item.id))
  expect(fullReads).toEqual(["a", "b", "a"])
  await read("b", null)
  current = [items[0]]
  await expect(read("a", second.nextCursor)).rejects.toThrow("history_cursor_expired")
})
