// @vitest-environment node

import { type SessionRunState } from "@alwith/api";
import { isText } from "@nyssance/codex-acp-v2/client";
import { runStateSource } from "@nyssance/codex-acp-v2/client";
import type { PetObservation } from "@alwith/module-auth/pets/core"
import { afterEach, expect, test, vi } from "vitest"

import { createFakeAgent } from "@/agent/__tests__/fake-agent"
import { FakeHubPort } from "@/agent/__tests__/fake-runtime-client"
import { CodexClient } from "@/agent/client"
import { must } from "@/lib/__tests__/must"

import { createPetSessionOwner } from "../session-host"

const clients: CodexClient[] = []
afterEach(() => {
  for (const client of clients.splice(0)) client.disconnect()
})
async function fixture() {
  const fake = createFakeAgent()
  const port = new FakeHubPort(() => fake.app)
  const client = new CodexClient(() => Promise.resolve(port), { agentId: "codex", launch: { engine: "fake" } })
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
    lastActivityAt: 10,
    version: 1,
    interruption: null
  })
  client.applyRunStates([run(a.id), run(b.id)], "snapshot")
  let agent: string | null = "codex"
  const claimed = new Set<string>()
  const prompt = vi.fn((id: string) => {
    return Promise.try(() => {
      expect(id).toBe(a.id)
    })
  })
  const openChat = vi.fn(async (_id: string | null, _window: "main" | "chat") => {})
  const agentForSession = vi.fn(async () => agent)
  const cancel = vi.fn(async (_id: string) => {})
  const markRead = vi.fn(async (_id: string) => {})
  const respond = vi.fn(client.respond.bind(client))
  const host = createPetSessionOwner({
    state: () => client.state,
    agentId: "codex",
    source: () => runStateSource(client.state.runStates),
    agentForSession,
    claim: (id) => {
      return Promise.try(() => {
        if (claimed.has(id)) return false
        claimed.add(id)
        return true
      })
    },
    prompt,
    cancel,
    markRead,
    respond,
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
    agentForSession,
    cancel,
    markRead,
    respond,
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
  await f.host.send(binding, "request-b", "hello")
  expect(f.prompt).toHaveBeenCalledTimes(2)
})
test("Runtime execution and foreign ownership stay read-only without attaching an agent", async () => {
  const f = await fixture()
  await f.host.surface("main", { sessionId: f.a.id, visible: false })
  const binding = must(f.host.snapshot(), "pet observation").binding
  f.setAgent("another-agent")
  await expect(f.host.send(binding, "foreign", "hello")).rejects.toThrow("read-only")
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
  expect(f.host.snapshot()?.taskFeed?.tasks).toEqual([])
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
  await f.host.minimized(true)
  const observation = must(f.host.snapshot(), "pet observation")
  expect(observation.prompt?.options).toEqual([{ id: "approve", label: "Allow once", decision: "allow" }])
  await expect(f.host.answer(observation.binding, "invalid", "permission", "invented")).rejects.toThrow(
    "expired or changed"
  )
  f.client.store.setState({ actions: [] })
  await expect(f.host.answer(observation.binding, "withdrawn", "permission", "approve")).rejects.toThrow(
    "expired or changed"
  )
})

test("session choices include background sessions and selection does not invalidate another task", async () => {
  const f = await fixture()
  await f.host.surface("main", { sessionId: f.a.id, visible: false })
  f.client.store.setState({ sessionWindows: { [f.b.id]: "chat" } })
  await f.host.surface("chat", { sessionId: f.b.id, visible: false })
  const chat = must(f.host.snapshot(), "pet observation")
  expect(chat.candidates.map((item) => [item.sessionId, item.windowLabel])).toEqual([
    [f.a.id, "main"],
    [f.b.id, "chat"]
  ])
  await f.host.select(chat.binding, f.a.id)
  const main = must(f.host.snapshot(), "pet observation")
  expect(main.binding.sessionId).toBe(f.a.id)
  expect(main.windowLabel).toBe("main")
  await f.host.select(chat.binding, f.b.id)
  await expect(f.host.select(main.binding, "unrelated")).rejects.toThrow("no longer current")
})

test("activation preserves the existing float conversation, while explicit open follows the binding", async () => {
  const f = await fixture()
  await f.host.surface("main", { sessionId: f.a.id, visible: false })
  const binding = must(f.host.snapshot(), "pet observation").binding
  await f.host.activate()
  expect(f.openChat).toHaveBeenLastCalledWith(null, "chat")
  await f.host.openChat(binding)
  expect(f.openChat).toHaveBeenLastCalledWith(f.a.id, "main")
})

test("a changed or closed float cannot be hidden by a pending collapse", async () => {
  const f = await fixture()
  await f.host.surface("chat", { sessionId: f.a.id, visible: true })
  f.host.requireSurface("chat", f.a.id)
  await f.host.surface("chat", { sessionId: f.b.id, visible: true })
  expect(() => f.host.requireSurface("chat", f.a.id)).toThrow("window changed")
  await f.host.surface("chat", { sessionId: f.b.id, visible: false })
  expect(() => f.host.requireSurface("chat", f.b.id)).toThrow("window changed")
})

test("opening a background binding targets its own main conversation", async () => {
  const f = await fixture()
  await f.host.surface("main", { sessionId: f.a.id, visible: false })
  await f.host.select(must(f.host.snapshot(), "pet observation").binding, f.a.id)
  const binding = must(f.host.snapshot(), "pet observation").binding
  await f.host.surface("main", { sessionId: f.b.id, visible: false })
  await f.host.openChat(binding)
  expect(f.openChat).toHaveBeenCalledWith(f.a.id, "main")
})

test("every live transition is published before a pending ownership lookup completes", async () => {
  const f = await fixture()
  await f.host.surface("main", { sessionId: f.a.id, visible: false })
  const observed: PetObservation[] = []
  f.host.subscribe((value) => {
    if (value !== null) observed.push(value)
  })
  const ownership = Promise.withResolvers<string | null>()
  f.agentForSession.mockImplementation(() => ownership.promise)
  const pending: Promise<void>[] = []
  for (const state of ["running", "done", "idle"] as const) {
    f.client.applyRunStates([{ ...f.run(f.a.id), state }])
    pending.push(f.host.refresh())
  }
  expect(observed.map((value) => value.state)).toEqual(["running", "done", "idle"])
  expect(observed.every((value) => value.source === "event")).toBe(true)
  ownership.resolve("codex")
  await Promise.all(pending)
  expect(observed.map((value) => value.state)).toEqual(["running", "done", "idle"])
})

test("surface replacement preserves an unrelated task binding", async () => {
  const f = await fixture()
  await f.host.surface("main", { sessionId: f.a.id, visible: false })
  await f.host.surface("chat", { sessionId: f.b.id, visible: false })
  await f.host.select(must(f.host.snapshot(), "pet observation").binding, f.a.id)
  const old = must(f.host.snapshot(), "pet observation").binding
  await f.host.surface("main", { sessionId: f.b.id, visible: false })
  expect(must(f.host.snapshot(), "pet observation").binding.sessionId).toBe(f.a.id)
  await f.host.send(old, "background", "hello")
  expect(f.prompt).toHaveBeenCalledWith(f.a.id, expect.anything())
})

test("a once-only pet answer resolves the original fake agent approval and keeps session ownership", async () => {
  const f = await fixture()
  await f.host.surface("main", { sessionId: f.a.id, visible: false })
  await f.client.prompt(f.a.id, [{ type: "text", text: "permission" }])
  const deadline = Date.now() + 3000
  while (f.client.state.actions.length === 0) {
    if (Date.now() >= deadline) throw new Error("Approval did not arrive")
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  await f.host.refresh()
  await f.host.minimized(true)
  const observation = must(f.host.snapshot(), "pet observation")
  const approval = must(observation.prompt, "pet approval")
  await f.host.answer(observation.binding, "allow-request", approval.token, "allow_once")
  while (!f.client.state.sessions[f.a.id]?.items.some((item) => item.kind === "assistant")) {
    if (Date.now() >= deadline) throw new Error("Approval response did not arrive")
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  expect(f.client.state.actions).toHaveLength(0)
  const reply = must(
    f.client.state.sessions[f.a.id]?.items.find((item) => item.kind === "assistant"),
    "approval reply"
  )
  if (reply.kind !== "assistant") throw new Error("Approval did not receive an assistant reply")
  expect(
    JSON.parse(
      reply.content
        .filter(isText)
        .map((block) => block.text)
        .join("")
    )
  ).toEqual({
    outcome: { outcome: "selected", optionId: "allow_once" }
  })
  expect(f.client.state.sessions[f.b.id]?.items).toHaveLength(0)
})

test("all active tasks survive surface changes and dismissal does not cancel or clear Runtime state", async () => {
  const f = await fixture()
  f.client.applyRunStates([
    { ...f.run(f.a.id), state: "running" },
    { ...f.run(f.b.id), state: "done" }
  ])
  await f.host.refresh()
  const tasks = must(f.host.snapshot()?.taskFeed, "task feed").tasks
  expect(tasks.map((task) => task.binding.sessionId)).toEqual([f.a.id, f.b.id])
  await f.host.dismiss(tasks[0].binding)
  expect(f.cancel).not.toHaveBeenCalled()
  expect(f.markRead).not.toHaveBeenCalled()
  expect(f.client.state.runStates[f.a.id].state).toBe("running")
  expect(f.host.snapshot()?.taskFeed?.tasks[0].hidden).toBe(true)
  await f.host.dismiss(tasks[1].binding)
  expect(f.markRead).toHaveBeenCalledExactlyOnceWith(f.b.id)
})

test("permission visibility follows actual minimization independently of surface visibility", async () => {
  const f = await fixture()
  await f.host.surface("main", { sessionId: f.a.id, visible: false })
  expect(f.host.snapshot()?.taskFeed?.mainMinimized).toBe(false)
  await f.host.minimized(true)
  expect(f.host.snapshot()?.taskFeed?.mainMinimized).toBe(true)
  await f.host.surface("main", { sessionId: f.b.id, visible: true })
  expect(f.host.snapshot()?.taskFeed?.mainMinimized).toBe(true)
  await f.host.minimized(false)
  expect(f.host.snapshot()?.taskFeed?.mainMinimized).toBe(false)
})

test("a failed Runtime read acknowledgement leaves the completed card available for retry", async () => {
  const f = await fixture()
  f.client.applyRunStates([{ ...f.run(f.a.id), state: "done" }])
  await f.host.refresh()
  const binding = must(f.host.snapshot()?.taskFeed, "task feed").tasks[0].binding
  f.markRead.mockRejectedValueOnce(new Error("Read acknowledgement failed"))
  await expect(f.host.dismiss(binding)).rejects.toThrow("Read acknowledgement failed")
  expect(f.host.snapshot()?.taskFeed?.tasks[0].hidden).toBe(false)
  await f.host.dismiss(binding)
  expect(f.markRead).toHaveBeenCalledTimes(2)
})

test("stopping targets the clicked session and feedback waits for Runtime state", async () => {
  const f = await fixture()
  f.client.applyRunStates([
    { ...f.run(f.a.id), state: "running" },
    { ...f.run(f.b.id), state: "running" }
  ])
  await f.host.refresh()
  const binding = must(f.host.snapshot()?.taskFeed, "task feed").tasks[1].binding
  await f.host.cancel(binding, "stop-b")
  expect(f.cancel).toHaveBeenCalledExactlyOnceWith(f.b.id)
  expect(f.host.snapshot()?.taskFeed?.tasks[1].state).toBe("running")
  f.client.applyRunStates([
    { ...f.run(f.a.id), state: "running" },
    { ...f.run(f.b.id), state: "idle", since: 20 }
  ])
  await f.host.refresh()
  expect(f.host.snapshot()?.taskFeed?.tasks[1]).toMatchObject({ state: "idle", stopped: true })
  expect(f.client.state.runStates[f.b.id].state).toBe("idle")
})

test("a completion remains observable before another task's pending permission is answered", async () => {
  const f = await fixture()
  f.client.applyRunStates([
    { ...f.run(f.a.id), state: "requires_action" },
    { ...f.run(f.b.id), state: "running" }
  ])
  await f.host.refresh()
  f.client.applyRunStates([
    { ...f.run(f.a.id), state: "requires_action" },
    { ...f.run(f.b.id), state: "done", since: 20 }
  ])
  await f.host.refresh()
  expect(f.host.snapshot()?.taskFeed?.tasks[1]).toMatchObject({
    state: "done",
    source: "event",
    completion: expect.any(String)
  })
  expect(f.host.snapshot()?.taskFeed?.tasks[0].state).toBe("requires_action")
})

test("ownership lookup is reused across streaming updates while actions still verify the owner", async () => {
  const f = await fixture()
  await f.host.refresh()
  f.agentForSession.mockClear()
  await f.host.refresh()
  await f.host.refresh()
  expect(f.agentForSession).not.toHaveBeenCalled()
  const binding = must(f.host.snapshot(), "observation").binding
  f.setAgent("foreign")
  await expect(f.host.send(binding, "foreign-owner", "hello")).rejects.toThrow("read-only")
  expect(f.prompt).not.toHaveBeenCalled()
})

test("collapsing a float opens its task even when another task is newer or its reminder was dismissed", async () => {
  const f = await fixture()
  f.client.applyRunStates([
    { ...f.run(f.a.id), state: "running", since: 20 },
    { ...f.run(f.b.id), state: "running", since: 30 }
  ])
  await f.host.refresh()
  const binding = must(f.host.snapshot()?.taskFeed, "tasks").tasks[0].binding
  await f.host.dismiss(binding)
  await f.host.collapse(f.a.id)
  const feed = must(f.host.snapshot()?.taskFeed, "collapsed task")
  expect(feed).toMatchObject({ panel: "expanded", focusedSessionId: f.a.id })
  expect(feed.tasks.find((task) => task.binding.sessionId === f.a.id)?.hidden).toBe(false)
  expect(feed.tasks).toHaveLength(2)
  f.client.applyRunStates([
    { ...f.run(f.a.id), state: "idle", since: 40 },
    { ...f.run(f.b.id), state: "running", since: 30 }
  ])
  await f.host.refresh()
  const completed = must(f.host.snapshot()?.taskFeed, "completed task").tasks.find(
    (task) => task.binding.sessionId === f.a.id
  )
  expect(completed?.state).toBe("idle")
  await f.host.send(binding, "continue-collapsed", "Continue this task")
  expect(f.prompt).toHaveBeenCalledWith(f.a.id, [{ type: "text", text: "Continue this task" }])
  await f.host.panel("hidden")
  expect(f.host.snapshot()?.taskFeed?.focusedSessionId).toBeUndefined()
  expect(f.host.snapshot()?.taskFeed?.tasks.map((task) => task.binding.sessionId)).toEqual([f.b.id])
})

test("repeated stop requests wait for the Runtime transition and a failed cancellation can retry", async () => {
  const f = await fixture()
  f.client.applyRunStates([{ ...f.run(f.a.id), state: "running" }, f.run(f.b.id)])
  await f.host.refresh()
  const binding = must(f.host.snapshot(), "task").binding
  f.cancel.mockRejectedValueOnce(new Error("cancel failed"))
  await expect(f.host.cancel(binding, "stop-failed")).rejects.toThrow("cancel failed")
  await f.host.cancel(binding, "stop-retry")
  await f.host.cancel(binding, "stop-repeat")
  expect(f.cancel).toHaveBeenCalledTimes(2)
  expect(f.client.state.runStates[f.a.id].state).toBe("running")
})

test("an authorization is answered once while its Runtime action remains pending and failures can retry", async () => {
  const f = await fixture()
  f.client.store.setState({
    actions: [
      {
        id: "pending",
        kind: "permission",
        sessionId: f.a.id,
        params: {
          sessionId: f.a.id,
          title: "Write file",
          options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }]
        }
      }
    ]
  })
  await f.host.minimized(true)
  const binding = must(f.host.snapshot(), "task").binding
  f.respond.mockImplementationOnce(() => {
    throw new Error("answer failed")
  })
  await expect(f.host.answer(binding, "answer-failed", "pending", "allow")).rejects.toThrow("answer failed")
  f.respond.mockImplementation(() => {})
  await Promise.all([
    f.host.answer(binding, "answer-retry", "pending", "allow"),
    f.host.answer(binding, "answer-repeat", "pending", "allow")
  ])
  expect(f.respond).toHaveBeenCalledTimes(2)
  expect(f.respond).toHaveBeenLastCalledWith("pending", { outcome: { outcome: "selected", optionId: "allow" } })
  expect(f.client.state.actions).toHaveLength(1)
})
