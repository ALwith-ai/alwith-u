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
    .map((line) => JSON.parse(line) as { type: string })
  expect(records.map((record) => record.type)).toEqual(["user", "assistant"])
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
        () => Promise.resolve(invalid),
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
      () =>
        Promise.try(() => ({
          ...page,
          items: [{ ...page.items[0], itemId: String(index++) }],
          complete: false,
          nextCursor: "loop"
        })),
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

const png = {
  type: "image",
  mimeType: "image/png",
  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aTWQAAAAASUVORK5CYII=",
  _meta: { codex: { detail: "original" } }
}

test.each(["user_message", "agent_message"])("exports ordered text and image blocks for %s", async (sessionUpdate) => {
  const content = [{ type: "text", text: "Before" }, png, { type: "text", text: "After" }, png]
  const body = await exportConversation(
    "s",
    async () => ({
      ...page,
      items: [{ ...page.items[0], updates: [{ sessionUpdate, content }] }]
    }),
    () => {}
  )
  const record = JSON.parse(body) as { message: { content: unknown[] } }
  expect(record.message.content).toEqual(content)
})

test("exports image-only messages and keeps unavailable image placeholders", async () => {
  const body = await exportConversation(
    "s",
    async () => ({
      ...page,
      items: [
        {
          ...page.items[0],
          updates: [
            { sessionUpdate: "user_message", content: [png] },
            {
              sessionUpdate: "user_message",
              content: [
                {
                  type: "resource_link",
                  name: "Image unavailable",
                  uri: "codex-image:unavailable",
                  _meta: { codex: { imageUnavailable: true } }
                }
              ]
            }
          ]
        }
      ]
    }),
    () => {}
  )
  const records = body
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { message: { content: unknown[] } })
  expect(records[0]?.message.content).toEqual([png])
  expect(records[1]?.message.content).toEqual([{ type: "text", text: "[Image unavailable] codex-image:unavailable" }])
})

test.each([
  { ...png, data: null },
  { ...png, data: "" },
  { ...png, mimeType: "text/plain" },
  { type: "audio", mimeType: "audio/wav", data: "AAAA" }
])("rejects unsupported or malformed media instead of partially archiving it: %j", async (block) => {
  await expect(
    exportConversation(
      "s",
      async () => ({
        ...page,
        items: [
          {
            ...page.items[0],
            updates: [{ sessionUpdate: "user_message", content: [{ type: "text", text: "Keep me" }, block] }]
          }
        ]
      }),
      () => {}
    )
  ).rejects.toThrow(/session s.*item u.*type/)
})

test("counts inline image bytes toward the complete archive size limit", async () => {
  await expect(
    exportConversation(
      "s",
      async () => ({
        ...page,
        items: [
          {
            ...page.items[0],
            updates: [
              { sessionUpdate: "user_message", content: [{ ...png, data: "AAAA".repeat((25 * 1024 * 1024) / 4) }] }
            ]
          }
        ]
      }),
      () => {}
    )
  ).rejects.toThrow("25 MiB")
})

test("reports a single item exceeding the history protocol budget without invalid larger requests", async () => {
  const calls: Array<{ limit: number; maxBytes: number }> = []
  await expect(
    exportConversation(
      "s",
      async (params) => {
        calls.push({ limit: params.limit, maxBytes: params.maxBytes })
        throw Object.assign(new Error("History page too large"), { data: { reason: "history_page_too_large" } })
      },
      () => {}
    )
  ).rejects.toThrow("16 MiB")
  expect(calls.map((call) => call.limit)).toEqual([50, 25, 12, 6, 3, 1])
  expect(calls.every((call) => call.maxBytes === 16 * 1024 * 1024)).toBe(true)
})
