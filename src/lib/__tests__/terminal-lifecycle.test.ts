import { expect, test, vi } from "vitest"

import { createFakeAgent } from "@/agent/__tests__/fake-agent"
import { FakeHubPort } from "@/agent/__tests__/fake-runtime-client"

import { DesktopCodexClient } from "../desktop-client"
vi.mock("@/features/chat/composer/input-mode-config", () => ({
  deleteSessionInputMode: vi.fn()
}))
test("cancel leaves application services running; archive and delete clean only their explicit chat", async () => {
  const fake = createFakeAgent(),
    port = new FakeHubPort(() => fake.app),
    closeSession = vi.fn().mockResolvedValue(undefined)
  const client = new DesktopCodexClient(
    () => Promise.resolve(port),
    { agentId: "codex", launch: { engine: "codex" } },
    { closeSession }
  )
  try {
    await client.connect()
    const a = await client.newSession("/a"),
      b = await client.newSession("/b")
    await client.cancel(a)
    expect(closeSession).not.toHaveBeenCalled()
    await client.archive(a)
    expect(closeSession).toHaveBeenCalledExactlyOnceWith(a)
    await client.delete(b)
    expect(closeSession).toHaveBeenLastCalledWith(b)
  } finally {
    client.disconnect()
  }
})

test.each(["main", "chat"] as const)(
  "%s draft model replacement drains terminal reads before retiring the old session",
  async (owner) => {
    const fake = createFakeAgent()
    const port = new FakeHubPort(() => fake.app)
    const client = new DesktopCodexClient(() => Promise.resolve(port), {
      agentId: "codex",
      launch: { engine: "codex" }
    })
    const read = Promise.withResolvers<void>()
    const deletion = Promise.withResolvers<void>()
    const listed: string[] = []
    const deleting: string[] = []
    let original: string
    fake.app.onRequest(
      "_codex/terminals/list",
      (value) => value as { sessionId: string },
      async ({ params }) => {
        listed.push(params.sessionId)
        if (params.sessionId === original) await read.promise
        if (fake.deleted.has(params.sessionId)) throw new Error("Session not found")
        return []
      }
    )
    fake.deleteSessionDelay.current = async (sessionId) => {
      deleting.push(sessionId)
      await deletion.promise
    }
    try {
      await client.connect()
      original = await client.prepareDraft(owner, "/tmp/model-race")
      const inFlight = client.listBackgroundTerminals(original)
      await vi.waitFor(() => expect(listed).toEqual([original]))
      const replacement = client.prepareDraft(owner, "/tmp/model-race", "another-model")
      await vi.waitFor(() => expect(fake.modelHints.size).toBe(2))
      expect(deleting).toEqual([])
      read.resolve()
      await expect(inFlight).resolves.toEqual([])
      await vi.waitFor(() => expect(deleting).toEqual([original]))
      const next = [...fake.modelHints.keys()].find((id) => id !== original)!
      // Simulate the old workspace's timer firing while remote deletion is pending.
      await expect(client.listBackgroundTerminals(original)).resolves.toEqual([])
      await expect(client.listBackgroundTerminals(next)).resolves.toEqual([])
      expect(listed).toEqual([original, next])
      deletion.resolve()
      await expect(replacement).resolves.toBe(next)
      expect(fake.deleted.has(original)).toBe(true)
      await expect(client.listBackgroundTerminals(original)).resolves.toEqual([])
      await expect(client.listBackgroundTerminals(next)).resolves.toEqual([])
      expect(listed).toEqual([original, next, next])
      expect(fake.modelHints.get(next)).toBe("another-model")
    } finally {
      read.resolve()
      deletion.resolve()
      client.disconnect()
    }
  }
)

test("failed deletion restores terminal polling and live terminal errors still propagate", async () => {
  const fake = createFakeAgent()
  const port = new FakeHubPort(() => fake.app)
  const closeSession = vi.fn().mockRejectedValueOnce(new Error("Cleanup failed"))
  const client = new DesktopCodexClient(
    () => Promise.resolve(port),
    { agentId: "codex", launch: { engine: "codex" } },
    { closeSession }
  )
  const list = vi.fn().mockResolvedValue([]).mockRejectedValueOnce(new Error("Terminal service failed"))
  fake.app.onRequest("_codex/terminals/list", (value) => value, list)
  try {
    await client.connect()
    const id = await client.prepareDraft("main", "/tmp/delete-failure")
    await expect(client.listBackgroundTerminals(id)).rejects.toThrow("Internal error")
    await expect(client.delete(id)).rejects.toThrow("Cleanup failed")
    await expect(client.listBackgroundTerminals(id)).resolves.toEqual([])
    expect(list).toHaveBeenCalledTimes(2)
    await client.delete(id)
    expect(fake.deleted.has(id)).toBe(true)
  } finally {
    client.disconnect()
  }
})
