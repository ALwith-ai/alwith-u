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
    { closeSession, adoptSession: vi.fn() }
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

test("a draft replaced by another hands its terminals over; a discarded draft closes them", async () => {
  const fake = createFakeAgent()
  const port = new FakeHubPort(() => fake.app)
  const closeSession = vi.fn().mockResolvedValue(undefined)
  const adoptSession = vi.fn().mockResolvedValue(undefined)
  const client = new DesktopCodexClient(
    () => Promise.resolve(port),
    { agentId: "codex", launch: { engine: "codex" } },
    { closeSession, adoptSession }
  )
  try {
    await client.connect()
    const first = await client.prepareDraft("main", "/tmp/replaced-draft")
    // Another model is another session: the draft is replaced, and what hangs on it follows.
    const replacement = await client.prepareDraft("main", "/tmp/replaced-draft", "another-model")
    expect(replacement).not.toBe(first)
    expect(adoptSession).toHaveBeenCalledExactlyOnceWith(first, replacement)
    expect(closeSession).not.toHaveBeenCalled()
    await client.discardDraft("main")
    expect(closeSession).toHaveBeenCalledExactlyOnceWith(replacement)
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
    { closeSession, adoptSession: vi.fn() }
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
