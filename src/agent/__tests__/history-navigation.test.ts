import { expect, test, vi } from "vitest"

import { codexMessageError } from "../codex-extensions"
import { historyTurnPreview, mergeNavigationHistory, readHistoryIndex, readHistoryTurn } from "../history-navigation"
import { readHistoryPage } from "../history-page"

const summary = (turnId: string) => ({ turnId, itemsView: "summary", startedAt: 100, completedAt: 105, updates: [] })
const response = (data: object, nextCursor: string | null = null) => ({
  sessionId: "s",
  consistency: "live",
  revision: null,
  nextCursor,
  complete: nextCursor === null,
  ...data
})
const user = (id: string) => ({
  sessionUpdate: "user_message",
  messageId: `u-${id}`,
  content: [{ type: "text", text: id }]
})
const answer = (id: string) => ({
  sessionUpdate: "agent_message",
  messageId: `a-${id}`,
  content: [{ type: "text", text: `**${id}**\n\nanswer` }]
})

test("sparse navigation retains terminal errors supplied by the turn index", async () => {
  const error = {
    sessionUpdate: "agent_message",
    messageId: "codex-error:old",
    content: [{ type: "text", text: "At capacity" }],
    _meta: { codex: { turnId: "old", error: { message: "At capacity", category: "overloaded", retryable: true } } }
  }
  const index = await readHistoryIndex(
    "s",
    async () => response({ turns: [{ ...summary("old"), status: "failed", updates: [error] }] }),
    () => {}
  )
  const session = await readHistoryTurn(
    "s",
    "/tmp",
    index[0],
    async () => response({ items: [{ turnId: "old", itemId: "u-old", updates: [user("old")] }] }),
    () => {}
  )
  const item = session.items.at(-1)
  if (item?.kind !== "assistant") throw new Error("The error was not restored")
  expect(codexMessageError(item)?.error?.message).toBe("At capacity")
  expect(session.lastStopReason).toBe("error")
})

test("indexes every turn using summary-only pages without fetching transcript bodies", async () => {
  const request = vi
    .fn<(method: string, params: Record<string, unknown>) => Promise<unknown>>()
    .mockResolvedValueOnce(response({ turns: [summary("new")] }, "older"))
    .mockResolvedValueOnce(response({ turns: [summary("old")] }))
  expect((await readHistoryIndex("s", request, () => {})).map((turn) => turn.turnId)).toEqual(["old", "new"])
  expect(
    request.mock.calls.every(
      ([method, params]) => method === "_codex/session_history" && params.itemsView === "summary"
    )
  ).toBe(true)
  expect(request.mock.calls[1][1].cursor).toBe("older")
})

test("rejects cross-session indexes, repeated cursors and duplicate turns", async () => {
  for (const pages of [
    [{ ...response({ turns: [] }), sessionId: "wrong" }],
    [response({ turns: [summary("one")] }, "cursor"), response({ turns: [summary("two")] }, "cursor")],
    [response({ turns: [summary("one"), summary("one")] })]
  ]) {
    const request = vi.fn<(method: string, params: Record<string, unknown>) => Promise<unknown>>()
    for (const page of pages) request.mockResolvedValueOnce(page)
    await expect(readHistoryIndex("s", request, () => {})).rejects.toThrow()
  }
})

test("hover is bounded while direct navigation reads all item pages of only the requested turn", async () => {
  const request = vi
    .fn<(method: string, params: Record<string, unknown>) => Promise<unknown>>()
    .mockImplementation((_method, params) =>
      Promise.try(() =>
        response(
          {
            items:
              params.cursor || params.sortDirection === "desc"
                ? [{ turnId: "old", itemId: "answer", updates: [answer("old")] }]
                : [{ turnId: "old", itemId: "user", updates: [user("old")] }]
          },
          params.cursor ? null : "next"
        )
      )
    )
  const preview = await readHistoryTurn("s", "/work", summary("old"), request, () => {}, true)
  expect(request).toHaveBeenCalledTimes(2)
  expect(preview.items).toHaveLength(2)
  request.mockClear()
  const full = await readHistoryTurn("s", "/work", summary("old"), request, () => {})
  expect(request).toHaveBeenCalledTimes(2)
  expect(
    request.mock.calls.every(([method, params]) => method === "_codex/session_history_items" && params.turnId === "old")
  ).toBe(true)
  expect(historyTurnPreview(full)).toMatchObject({
    state: "loaded",
    messages: [{ label: "old", response: "**old**\n\nanswer" }]
  })
  expect(full.items[0]._meta?.codex).toMatchObject({ turnId: "old", messageSentAt: 100000, historyReplay: true })
})

test("sparse hydration, later pagination and live upserts retain native chronological order", async () => {
  const page = async (id: string) =>
    (
      await readHistoryPage("s", "/work", null, () =>
        Promise.try(() =>
          response({
            turns: [{ ...summary(id), itemsView: "full", updates: [user(id), answer(id)] }]
          })
        )
      )
    ).session
  const index = [summary("old"), summary("middle"), summary("new")]
  const recent = await page("new")
  const old = await page("old")
  const middle = await page("middle")
  const sparse = mergeNavigationHistory(recent, old, index)
  const filled = mergeNavigationHistory(sparse, middle, index)
  expect(filled.items.map((item) => item.id)).toEqual(["u-old", "a-old", "u-middle", "a-middle", "u-new", "a-new"])
  const repeated = mergeNavigationHistory(filled, old, index)
  expect(repeated.items).toEqual(filled.items)
  expect(repeated.items[4]).toBe(recent.items[0])
})

test("a cancelled read cannot publish a late index or target", async () => {
  let active = true
  const check = () => {
    if (!active) throw new Error("cancelled")
  }
  const request = vi
    .fn<(method: string, params: Record<string, unknown>) => Promise<unknown>>()
    .mockImplementation(() => {
      return Promise.try(() => {
        active = false
        return response({ turns: [summary("old")] })
      })
    })
  await expect(readHistoryIndex("s", request, check)).rejects.toThrow("cancelled")
})
