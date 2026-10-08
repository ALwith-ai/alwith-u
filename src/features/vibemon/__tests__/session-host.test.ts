import { afterEach, expect, mock, test } from "bun:test"
import type { SessionRunState } from "@alwith/api"
import { must } from "@/lib/__tests__/must"
import { CodexClient } from "@/agent/client"
import { createFakeAgent } from "@/agent/__tests__/fake-agent"
import { FakeHubPort } from "@/agent/__tests__/fake-runtime-client"
import { createPetSessionOwner } from "../session-host"

const clients: CodexClient[] = []
afterEach(() => {
  for (const client of clients.splice(0)) client.disconnect()
})
async function fixture() {
  const fake = createFakeAgent()
  const port = new FakeHubPort(() => fake.app)
  const client = new CodexClient(async () => port, { agentId: "codex", launch: { engine: "fake" } })
  clients.push(client)
  await client.connect()
  const a = { id: await client.newSession("/tmp") }
  const b = { id: await client.newSession("/tmp") }
  const run = (sessionId: string, owner = "opaque-owner"): SessionRunState => ({
    sessionId,
    state: "idle",
    since: 10,
    owner,
    title: sessionId,
    cwd: "/tmp",
    executionId: null,
    executionRole: null,
    reusableDraft: false,
    tasks: [],
    listeningPorts: [],
    lastActivityAt: 10
  })
  client.applyRunStates([run(a.id), run(b.id)], "snapshot")
  let agent: string | null = "codex"
  const claimed = new Set<string>()
  const prompt = mock(async (id: string) => {
    expect(id).toBe(a.id)
  })
  const openChat = mock(async (_id: string | null) => {})
  const host = createPetSessionOwner({
    state: () => client.state,
    agentId: "codex",
    source: () => "event",
    agentForSession: async () => agent,
    claim: async id => {
      if (claimed.has(id)) return false
      claimed.add(id)
      return true
    },
    prompt,
    respond: client.respond.bind(client),
    openChat
  })
  return {
    client,
    host,
    a,
    b,
    run,
    prompt,
    openChat,
    setAgent: (value: string | null) => {
      agent = value
    }
  }
}
test("the explicit binding survives an unrelated selected-chat change and cannot be replayed", async () => {
  const f = await fixture()
  await f.host.surface("main", { sessionId: f.b.id, visible: true })
  await f.host.collapse(f.a.id)
  const binding = must(f.host.snapshot(), "pet observation").binding
  await f.host.send(binding, "request-a", "hello")
  await expect(f.host.send(binding, "request-a", "hello")).rejects.toThrow("already submitted")
  expect(f.prompt).toHaveBeenCalledTimes(1)
  await f.host.surface("chat", { sessionId: f.b.id, visible: true })
  await expect(f.host.send(binding, "request-b", "hello")).rejects.toThrow("changed")
  expect(f.prompt).toHaveBeenCalledTimes(1)
})
test("Runtime execution and foreign ownership stay read-only without attaching an agent", async () => {
  const f = await fixture()
  await f.host.surface("main", { sessionId: f.a.id, visible: false })
  const binding = must(f.host.snapshot(), "pet observation").binding
  f.setAgent("another-agent")
  await expect(f.host.send(binding, "foreign", "hello")).rejects.toThrow("changed")
  f.setAgent("codex")
  f.client.applyRunStates([{ ...f.run(f.a.id), executionId: "execution", executionRole: "child" }])
  await f.host.refresh()
  expect(must(f.host.snapshot(), "pet observation").access).toBe("readOnly")
  expect(f.prompt).not.toHaveBeenCalled()
})
test("epoch invalidation rejects old requests and a missing session remains idle", async () => {
  const f = await fixture()
  await f.host.surface("main", { sessionId: f.a.id, visible: false })
  const old = must(f.host.snapshot(), "pet observation").binding
  f.host.invalidate()
  await f.host.refresh()
  await expect(f.host.send(old, "old", "hello")).rejects.toThrow("changed")
  await f.host.surface("main", { sessionId: null, visible: false })
  expect(f.host.snapshot()).toBeNull()
  expect(f.prompt).not.toHaveBeenCalled()
})
test("permission answers use the original request token and options", async () => {
  const f = await fixture()
  await f.host.surface("main", { sessionId: f.a.id, visible: false })
  f.client.store.setState({
    actions: [
      {
        id: "permission",
        kind: "permission",
        sessionId: f.a.id,
        params: {
          sessionId: f.a.id,
          title: "Write file",
          options: [{ optionId: "approve", kind: "allow_once", name: "Allow once" }]
        }
      }
    ]
  })
  await f.host.refresh()
  const observation = must(f.host.snapshot(), "pet observation")
  expect(observation.prompt?.options).toEqual([{ id: "approve", label: "Allow once" }])
  await expect(f.host.answer(observation.binding, "invalid", "permission", "invented")).rejects.toThrow(
    "expired or changed"
  )
  f.client.store.setState({ actions: [] })
  await expect(f.host.answer(observation.binding, "withdrawn", "permission", "approve")).rejects.toThrow(
    "expired or changed"
  )
})
