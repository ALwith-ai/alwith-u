import { expect, test, vi } from "vitest"

import { createFakeAgent } from "@alwith/module-chat/testing"
import { FakeHubPort } from "@alwith/module-chat/testing"

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

test("a failed deletion leaves the chat deletable", async () => {
  const fake = createFakeAgent()
  const port = new FakeHubPort(() => fake.app)
  const closeSession = vi.fn().mockRejectedValueOnce(new Error("Cleanup failed"))
  const client = new DesktopCodexClient(
    () => Promise.resolve(port),
    { agentId: "codex", launch: { engine: "codex" } },
    { closeSession }
  )
  try {
    await client.connect()
    const id = await client.prepareDraft("main", "/tmp/delete-failure")
    await expect(client.delete(id)).rejects.toThrow("Cleanup failed")
    await client.delete(id)
    expect(fake.deleted.has(id)).toBe(true)
  } finally {
    client.disconnect()
  }
})
