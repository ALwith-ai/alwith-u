import { CodexClient } from "@alwith/module-chat/client"
import { expect, test, vi } from "vitest"

import { createFakeAgent } from "./fake-agent"
import { FakeHubPort } from "./fake-runtime-client"

test.each(["main", "chat"] as const)(
  "closing every activity, including %s drafts, leaves a new draft writable",
  async (owner) => {
    const fake = createFakeAgent()
    const port = new FakeHubPort(() => fake.app)
    const client = new CodexClient(() => Promise.resolve(port), {
      agentId: "codex",
      launch: { engine: "codex" }
    })
    const closed = new Set<string>()
    const request = port.acpRequest.bind(port)
    vi.spyOn(port, "acpRequest").mockImplementation(async (agentId, method, params) => {
      const id = (params as { sessionId?: string } | undefined)?.sessionId
      if (id && closed.has(id)) throw new Error("acpRequest: Session not found")
      const result = await request(agentId, method, params)
      if (id && (method === "session/close" || method === "session/delete")) closed.add(id)
      return result
    })
    try {
      await client.connect()
      const used = await client.newSession("/tmp/used")
      await client.prompt(used, [{ type: "text", text: "hello" }])
      await vi.waitFor(() => expect(client.session(used).state).toBe("idle"))
      const unsent = await client.prepareDraft(owner, "/tmp/next")
      await client.stopSession(used)
      await client.stopSession(unsent)
      expect(client.state.draftSessions[unsent]).toBeUndefined()
      expect(client.state.sessions[used]?.attached).toBe(false)
      await client.discardDraft(owner)
      const next = await client.prepareDraft(owner, "/tmp/next")
      expect(next).not.toBe(unsent)
      expect(client.session(next)).toMatchObject({ attached: true, readOnly: false, restoring: false })
      await client.prompt(next, [{ type: "text", text: "new conversation" }])
      expect(client.state.draftSessions[next]).toBeUndefined()
      await vi.waitFor(() => expect(client.session(next).state).toBe("idle"))
      expect(client.session(next).items.some((item) => item.kind === "assistant")).toBe(true)
    } finally {
      client.disconnect()
      vi.restoreAllMocks()
    }
  }
)
