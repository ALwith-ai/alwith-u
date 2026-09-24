import { expect, test } from "bun:test"
import type { EventCallback, EventName } from "@tauri-apps/api/event"
import { CodexClient } from "@/agent/client"
import { createFakeAgent } from "@/agent/__tests__/fake-agent"
import { FakeHubPort } from "@/agent/__tests__/fake-runtime-client"
import { RemoteChatClient, serveChatClient, type ChatEvents } from "../chat-window-client"

function eventBus(): ChatEvents {
  const handlers = new Map<string, Set<EventCallback<unknown>>>()
  return {
    listen: async <T>(name: EventName, callback: EventCallback<T>) => {
      await Promise.resolve()
      const bucket = handlers.get(name) ?? new Set()
      handlers.set(name, bucket)
      bucket.add(callback as EventCallback<unknown>)
      return () => {
        bucket.delete(callback as EventCallback<unknown>)
      }
    },
    emitTo: async (_target, event, payload) => {
      for (const callback of handlers.get(event) ?? []) callback({ event, id: 0, payload: structuredClone(payload) })
    }
  }
}

test("floating fork sends the source and turn to the owner and receives the new session", async () => {
  const fake = createFakeAgent()
  const port = new FakeHubPort(() => fake.app)
  const owner = new CodexClient(async () => port, { agentId: "codex", launch: { engine: "codex" } })
  const transport = eventBus()
  const stop = await serveChatClient(owner, transport)
  const remote = new RemoteChatClient(transport)
  try {
    await remote.connect()
    const source = await remote.newSession("/tmp/floating")
    const child = await remote.fork(source, "/tmp/floating", "turn-1")
    expect(fake.forks[0]).toMatchObject({ sessionId: source, _meta: { codex: { lastTurnId: "turn-1" } } })
    expect(remote.state.threads.find(thread => thread.sessionId === child)?.forkedFromId).toBe(source)
    expect(remote.session(child).attached).toBe(true)
    fake.listSessions.current = () => ({
      sessions: [source, child].map(sessionId => ({
        sessionId,
        cwd: "/tmp/floating",
        _meta: { codex: { nativeSessionId: source, forkedFromId: sessionId === source ? null : source } }
      }))
    })
    expect((await remote.listBranches(child)).map(thread => thread.sessionId)).toEqual([source, child])
    expect(port.started).toEqual(["codex"])
  } finally {
    remote.disconnect()
    stop()
    owner.disconnect()
  }
})

test("chat window operates the existing client without starting or attaching a second agent", async () => {
  const fake = createFakeAgent()
  const port = new FakeHubPort(() => fake.app)
  const owner = new CodexClient(async () => port, { agentId: "codex", launch: { engine: "codex" } })
  const events = eventBus()
  const stop = await serveChatClient(owner, events)
  const remote = new RemoteChatClient(events)
  try {
    await remote.connect()
    const id = await remote.newSession("/tmp/chat-window")
    expect(remote.state.sessions[id].cwd).toBe("/tmp/chat-window")
    await remote.open(id, "/tmp/chat-window")
    await remote.prompt(id, [{ type: "text", text: "hello" }])
    expect(owner.session(id).items.length).toBeGreaterThan(0)
    expect(remote.state.sessions[id].items).toEqual(owner.session(id).items)
    expect(port.started).toEqual(["codex"])
    expect(port.attached).toEqual([])
    remote.disconnect()
    expect(owner.state.connection).toBe("ready")
  } finally {
    remote.disconnect()
    stop()
    owner.disconnect()
  }
})

test("the bridge returns operation errors and disconnect rejects pending calls", async () => {
  const fake = createFakeAgent()
  const port = new FakeHubPort(() => fake.app)
  const owner = new CodexClient(async () => port, { agentId: "codex", launch: { engine: "codex" } })
  const events = eventBus()
  const stop = await serveChatClient(owner, events)
  const remote = new RemoteChatClient(events)
  try {
    await remote.connect()
    const id = await remote.newSession("/tmp/chat-window")
    await expect(remote.prompt(id, [])).rejects.toThrow("Enter a message")
    stop()
    const pending = remote.readRateLimits()
    remote.disconnect()
    await expect(pending).rejects.toThrow("Chat window disconnected")
  } finally {
    remote.disconnect()
    owner.disconnect()
  }
})

test("floating rename and delete target only the explicit session and synchronize both windows", async () => {
  const fake = createFakeAgent()
  const port = new FakeHubPort(() => fake.app)
  const owner = new CodexClient(async () => port, { agentId: "codex", launch: { engine: "codex" } })
  const transport = eventBus()
  const stop = await serveChatClient(owner, transport)
  const remote = new RemoteChatClient(transport)
  try {
    await remote.connect()
    const floatingId = await remote.newSession("/tmp/floating-project")
    const mainId = await owner.newSession("/tmp/main-project")
    await remote.renameSession(floatingId, "Renamed floating chat")
    expect(fake.renamed.get(floatingId)).toBe("Renamed floating chat")
    expect(fake.renamed.has(mainId)).toBe(false)
    expect(owner.session(floatingId).title).toBe("Renamed floating chat")
    expect(remote.session(floatingId).title).toBe("Renamed floating chat")
    await remote.delete(floatingId)
    expect(fake.deleted.has(floatingId)).toBe(true)
    expect(fake.deleted.has(mainId)).toBe(false)
    expect(owner.state.sessions[floatingId]).toBeUndefined()
    expect(remote.state.sessions[floatingId]).toBeUndefined()
    expect(remote.session(mainId)).toEqual(owner.session(mainId))
    expect(port.started).toEqual(["codex"])
  } finally {
    remote.disconnect()
    stop()
    owner.disconnect()
  }
})

test("an already initialized window reconnects the owner after Runtime disconnect", async () => {
  const fake = createFakeAgent()
  const port = new FakeHubPort(() => fake.app)
  const owner = new CodexClient(async () => port, { agentId: "codex", launch: { engine: "codex" } })
  const transport = eventBus()
  const stop = await serveChatClient(owner, transport)
  const remote = new RemoteChatClient(transport)
  try {
    await remote.connect()
    owner.disconnect()
    await new Promise<void>(resolve => queueMicrotask(resolve))
    await remote.connect()
    expect(owner.state.connection).toBe("ready")
    expect(remote.state.connection).toBe("ready")
  } finally {
    remote.disconnect()
    stop()
    owner.disconnect()
  }
})

test("a disposed StrictMode initialization cannot disconnect its replacement", async () => {
  const fake = createFakeAgent()
  const port = new FakeHubPort(() => fake.app)
  const owner = new CodexClient(async () => port, { agentId: "codex", launch: { engine: "codex" } })
  const transport = eventBus()
  const stop = await serveChatClient(owner, transport)
  const remote = new RemoteChatClient(transport)
  try {
    const old = remote.connect()
    remote.disconnect()
    const current = remote.connect()
    await expect(old).rejects.toThrow("disconnected")
    await current
    expect(remote.state.connection).toBe("ready")
  } finally {
    remote.disconnect()
    stop()
    owner.disconnect()
  }
})

test("a failed state delivery is reported and later updates restore a full snapshot", async () => {
  const fake = createFakeAgent()
  const port = new FakeHubPort(() => fake.app)
  const owner = new CodexClient(async () => port, { agentId: "codex", launch: { engine: "codex" } })
  const bus = eventBus()
  let failNext = false
  const errors: unknown[] = []
  const transport: ChatEvents = {
    ...bus,
    emitTo: async (target, event, payload) => {
      if (event === "chat:client-state" && failNext) {
        failNext = false
        throw new Error("delivery failed")
      }
      await bus.emitTo(target, event, payload)
    }
  }
  const stop = await serveChatClient(owner, transport, error => errors.push(error))
  const remote = new RemoteChatClient(transport)
  try {
    await remote.connect()
    failNext = true
    owner.store.setState({ connectionError: "test failure" })
    // Drain the delivery queue, then trigger a distinct update without changing the lost field.
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    expect(errors).toHaveLength(1)
    expect(remote.state.connectionError).not.toBe("test failure")
    const id = await remote.newSession("/tmp/recovery")
    expect(remote.state.connectionError).toBe("test failure")
    expect(remote.session(id)).toEqual(owner.session(id))
  } finally {
    remote.disconnect()
    stop()
    owner.disconnect()
  }
})
