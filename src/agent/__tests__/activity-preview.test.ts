import { expect, test } from "vitest"

import { readActivityReply } from "../activity-preview"

const page = (items: unknown[], nextCursor: string | null = null) => ({
  sessionId: "s",
  consistency: "live",
  revision: null,
  items,
  nextCursor,
  complete: nextCursor === null
})
const message = (text: string) => ({
  updates: [{ sessionUpdate: "agent_message", messageId: "a", content: [{ type: "text", text }] }]
})

test("walks newest-first items past tools and thoughts and stops at the latest response", async () => {
  const requests: Record<string, unknown>[] = []
  const result = await readActivityReply(
    "s",
    (request) => {
      requests.push(request)
      return Promise.resolve(
        request.cursor
          ? page([message("Latest\n reply"), message("Earlier")])
          : page(
              [
                {
                  updates: [
                    {
                      sessionUpdate: "agent_thought",
                      messageId: "private",
                      content: [{ type: "text", text: "Thought" }]
                    }
                  ]
                },
                { updates: [{ sessionUpdate: "tool_call", toolCallId: "tool", title: "Tool" }] }
              ],
              "older"
            )
      )
    },
    () => {}
  )
  expect(result).toBe("Latest reply")
  expect(requests).toHaveLength(2)
  expect(requests[0]).toMatchObject({ sessionId: "s", mode: "browse", sortDirection: "desc" })
  expect(requests[1]?.cursor).toBe("older")
})

test("rejects another session and cyclic pagination", async () => {
  await expect(
    readActivityReply(
      "s",
      () => Promise.resolve({ ...page([]), sessionId: "other" }),
      () => {}
    )
  ).rejects.toThrow("pagination")
  await expect(
    readActivityReply(
      "s",
      () => Promise.resolve(page([{ updates: [] }], "same")),
      () => {}
    )
  ).rejects.toThrow("pagination")
})

test("a disconnected preview cannot publish its completed read", async () => {
  let alive = true
  await expect(
    readActivityReply(
      "s",
      () => {
        alive = false
        return Promise.resolve(page([message("stale")]))
      },
      () => {
        if (!alive) throw new Error("Disconnected")
      }
    )
  ).rejects.toThrow("Disconnected")
})

test("preview extracts validated text, skips invalid text and rejects non-object blocks", async () => {
  const read = (content: unknown[]) =>
    readActivityReply(
      "s",
      () => Promise.resolve(page([{ updates: [{ sessionUpdate: "agent_message", messageId: "a", content }] }])),
      () => {}
    )
  await expect(
    read([
      { type: "image", data: "ignored", mimeType: "image/png" },
      { type: "text", text: "Reply" }
    ])
  ).resolves.toBe("Reply")
  await expect(read([{ type: "text", text: 42 }])).resolves.toBeNull()
  await expect(read([null])).rejects.toThrow("Invalid activity preview")
})
