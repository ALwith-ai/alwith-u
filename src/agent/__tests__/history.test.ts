import { expect, test, vi } from "vitest"
import { exportConversation } from "../history"

const page = {
  sessionId: "s",
  cwd: "/work",
  createdAt: 100,
  updatedAt: 101,
  running: false,
  consistency: "optimistic",
  revision: "revision",
  complete: true,
  nextCursor: null,
  items: [
    {
      itemId: "u",
      turnId: "t",
      startedAtMs: 100000,
      updates: [
        { sessionUpdate: "user_message", messageId: "u", content: [{ type: "text", text: "Question" }] },
        { sessionUpdate: "agent_message", messageId: "a", content: [{ type: "text", text: "Answer" }] },
        { sessionUpdate: "agent_thought", content: [{ type: "text", text: "Private reasoning" }] }
      ]
    }
  ]
}

test("exports paginated text conversations without resuming a session", async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce({ ...page, complete: false, nextCursor: "next" })
    .mockResolvedValueOnce({ ...page, items: [] })
  const body = await exportConversation("s", request, () => {})
  const records = body
    .trim()
    .split("\n")
    .map(line => JSON.parse(line))
  expect(records.map(record => record.type)).toEqual(["user", "assistant"])
  expect(records[0]).toMatchObject({
    sessionId: "s",
    timestamp: "1970-01-01T00:01:40.000Z",
    message: { content: [{ type: "text", text: "Question" }] }
  })
  expect(body).not.toContain("Private reasoning")
  expect(request.mock.calls[1]?.[0]).toMatchObject({
    sessionId: "s",
    mode: "export",
    cursor: "next",
    sortDirection: "asc"
  })
})

test("rejects cross-session, partial, running and changed history instead of exporting it", async () => {
  for (const invalid of [
    { ...page, sessionId: "other" },
    { ...page, running: true },
    { ...page, consistency: "live" },
    { ...page, running: undefined },
    { ...page, items: [], complete: false, nextCursor: "no-progress" },
    { ...page, complete: false },
    { ...page, items: [{ ...page.items[0], updates: [{ sessionUpdate: "user_message", content: null }] }] }
  ]) {
    await expect(
      exportConversation(
        "s",
        async () => invalid,
        () => {}
      )
    ).rejects.toThrow()
  }
  const request = vi
    .fn()
    .mockResolvedValueOnce({ ...page, complete: false, nextCursor: "next" })
    .mockResolvedValueOnce({ ...page, revision: "changed" })
  await expect(exportConversation("s", request, () => {})).rejects.toThrow()
})

test("rejects repeated cursors and respects activation cancellation", async () => {
  let index = 0
  await expect(
    exportConversation(
      "s",
      async () => ({
        ...page,
        items: [{ ...page.items[0], itemId: String(index++) }],
        complete: false,
        nextCursor: "loop"
      }),
      () => {}
    )
  ).rejects.toThrow("repeated cursor")
  const request = vi.fn()
  await expect(
    exportConversation("s", request, () => {
      throw new Error("cancelled")
    })
  ).rejects.toThrow("cancelled")
  expect(request).not.toHaveBeenCalled()
})

test("retries oversized pages at the same cursor and retains attachment references", async () => {
  const request = vi
    .fn()
    .mockRejectedValueOnce({ data: { reason: "history_page_too_large" } })
    .mockResolvedValueOnce({
      ...page,
      items: [
        {
          ...page.items[0],
          updates: [
            {
              sessionUpdate: "user_message",
              content: [{ type: "resource_link", name: "Image", uri: "file:///tmp/image.png" }]
            }
          ]
        }
      ]
    })
  expect(await exportConversation("s", request, () => {})).toContain("file:///tmp/image.png")
  expect(request.mock.calls[1]?.[0]).toMatchObject({ limit: 25, cursor: undefined })
})
