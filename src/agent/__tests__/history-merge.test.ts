import { createSession, SessionStore, textOf } from "@nyssance/codex-acp-v2/client";
import { type BrowseHistoryRequest, prependHistory, readHistoryPage } from "@nyssance/codex-acp-v2/client"
import { expect, test, vi } from "vitest"

const turn = (id: string, text = id) => ({
  turnId: id,
  itemsView: "full",
  updates: [
    { sessionUpdate: "user_message", messageId: `u-${id}`, content: [{ type: "text", text }] },
    {
      sessionUpdate: "tool_call_update",
      toolCallId: `tool-${id}`,
      title: "Run",
      status: "in_progress",
      content: [{ type: "content", content: { type: "text", text: "old" } }]
    },
    {
      sessionUpdate: "tool_call_update",
      toolCallId: `tool-${id}`,
      status: "completed",
      content: [{ type: "content", content: { type: "text", text: "complete" } }]
    }
  ]
})
const page = (turns: unknown[] = [turn("new"), turn("old")], nextCursor: string | null = null) => ({
  sessionId: "s",
  consistency: "live",
  revision: null,
  turns,
  nextCursor,
  complete: nextCursor === null
})

test("folds descending history in chronological order with replacement tool patches and replay markers", async () => {
  const request = vi.fn<(params: BrowseHistoryRequest) => Promise<unknown>>().mockResolvedValue(page())
  const result = await readHistoryPage("s", "/work", null, request)
  expect(result.session.items.map((item) => item.id)).toEqual(["u-old", "tool-old", "u-new", "tool-new"])
  expect(result.session.items.every((item) => item.replayed)).toBe(true)
  expect(result.session.items[1]).toMatchObject({ status: "completed", content: [{ content: { text: "complete" } }] })
  expect(request).toHaveBeenCalledWith(
    expect.objectContaining({ mode: "browse", itemsView: "full", sortDirection: "desc", limit: 5 })
  )
})

test("retries oversized pages at the same cursor with a smaller turn count", async () => {
  const request = vi
    .fn<(params: BrowseHistoryRequest) => Promise<unknown>>()
    .mockRejectedValueOnce({ data: { reason: "history_page_too_large" } })
    .mockResolvedValue(page())
  await readHistoryPage("s", "/work", "cursor", request)
  expect(request.mock.calls.map(([params]) => [params.cursor, params.limit])).toEqual([
    ["cursor", 5],
    ["cursor", 2]
  ])
})

test("paged turns retain native timestamps, durations and interruption markers", async () => {
  const result = await readHistoryPage("s", "/work", null, () =>
    Promise.try(() =>
      page([
        {
          ...turn("timed"),
          startedAt: 100,
          completedAt: 105,
          durationMs: 5000,
          status: "interrupted"
        }
      ])
    )
  )
  expect(result.session.items[0]._meta?.codex).toMatchObject({
    turnId: "timed",
    turnStartedAt: 100000,
    messageSentAt: 100000,
    turnCompletedAt: 105000,
    turnDurationMs: 5000,
    historyInterrupted: true,
    historyReplay: true
  })
})

test("rejects malformed, cross-session and non-progressing pages", async () => {
  for (const invalid of [
    { ...page(), sessionId: "other" },
    { ...page(), complete: false },
    page([], "next"),
    page([turn("same"), turn("same")]),
    page([{ ...turn("bad"), updates: [{ sessionUpdate: "agent_message", content: null }] }]),
    page([turn("old")], "cursor")
  ])
    await expect(readHistoryPage("s", "/work", "cursor", () => Promise.resolve(invalid))).rejects.toThrow()
})

test("older pages and refreshing the tail preserve live upserts, earlier history and current lifecycle", async () => {
  const recent = await readHistoryPage("s", "/work", null, () => Promise.try(() => page([turn("new")])))
  const earlier = await readHistoryPage("s", "/work", "cursor", () => Promise.try(() => page([turn("old")])))
  const store = new SessionStore({ toolContent: "replace" })
  store.set({ ...createSession("s", "/work"), ...recent.session, restoring: false, attached: true })
  store.accept("s", { sessionUpdate: "user_message", messageId: "u-new", content: [{ type: "text", text: "live" }] })
  store.accept("s", { sessionUpdate: "state_update", state: "running" })
  const merged = prependHistory(store.get("s"), earlier.session)
  const refreshed = prependHistory(merged, recent.session)
  expect(refreshed.items.map((item) => item.id)).toEqual(["u-old", "tool-old", "u-new", "tool-new"])
  const message = refreshed.items.find((item) => item.id === "u-new")
  if (message === undefined) throw new Error("Missing user message")
  expect(message.kind === "user" && textOf(message.content)).toBe("live")
  expect(refreshed).toMatchObject({ attached: true, state: "running", restoring: false })
})

test("refresh replaces stale cached snapshots and restores the persisted title while preserving newer live messages", async () => {
  const baseline = await readHistoryPage("s", "/work", null, () =>
    Promise.try(() => ({
      ...page([turn("new", "stale")]),
      title: "Saved title"
    }))
  )
  const latest = await readHistoryPage("s", "/work", null, () =>
    Promise.try(() => ({
      ...page([turn("new", "updated")]),
      title: "Renamed"
    }))
  )
  const refreshed = prependHistory(baseline.session, latest.session, baseline.session)
  expect(refreshed.title).toBe("Renamed")
  expect(refreshed.items[0]).toMatchObject({ content: [{ text: "updated" }] })
})

test("terminal history repairs a running tool without completing other work or moving it past a steer", () => {
  const store = new SessionStore({ toolContent: "replace" })
  store.set(createSession("s", "/work"))
  store.accept("s", { sessionUpdate: "state_update", state: "running" })
  store.accept("s", { sessionUpdate: "tool_call_update", toolCallId: "old", status: "in_progress" })
  store.accept("s", { sessionUpdate: "terminal_update", terminalId: "old" })
  const stale = store.get("s")
  store.accept("s", { sessionUpdate: "tool_call_update", toolCallId: "old", status: "failed" })
  store.accept("s", { sessionUpdate: "terminal_update", terminalId: "old", exitStatus: { exitCode: 143 } })
  const completed = store.get("s")
  store.set(stale)
  store.accept("s", { sessionUpdate: "user_message", messageId: "steer", content: [{ type: "text", text: "More" }] })
  store.accept("s", { sessionUpdate: "tool_call_update", toolCallId: "new", status: "in_progress" })
  const current = store.get("s")
  const merged = prependHistory(current, completed)
  expect(merged.items.map((item) => item.id)).toEqual(["old", "steer", "new"])
  expect(merged.items[0]).toMatchObject({ status: "failed", replayed: false, at: stale.items[0].at })
  expect(merged.items[2]).toMatchObject({ status: "in_progress" })
  expect(merged.terminals.old.exitStatus).toEqual({ exitCode: 143 })
  expect(merged.state).toBe("running")
  expect(prependHistory(merged, stale, merged).items[0]).toMatchObject({ status: "failed" })
  expect(prependHistory(merged, stale, merged).terminals.old.exitStatus).toEqual({ exitCode: 143 })
})
