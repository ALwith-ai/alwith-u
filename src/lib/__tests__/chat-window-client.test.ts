import type * as acp from "@agentclientprotocol/sdk/experimental/v2"
import type { EventCallback, EventName } from "@tauri-apps/api/event"
import { expect, test, vi } from "vitest"
import { createFakeAgent } from "@/agent/__tests__/fake-agent"
import { FakeHubPort } from "@/agent/__tests__/fake-runtime-client"
import { CodexClient } from "@/agent/client"
import { type ChatEvents, RemoteChatClient, serveChatClient } from "../chat-window-client"
import { DesktopCodexClient } from "../desktop-client"

const initialFiles = vi.hoisted(() => vi.fn())
vi.mock("../initial-file-results", () => ({ initialFileResults: initialFiles }))

test("floating file completion delegates both empty and typed queries to the main owner", async () => {
  const fake = createFakeAgent()
  const port = new FakeHubPort(() => fake.app)
  const owner = new DesktopCodexClient(async () => port, { agentId: "codex", launch: { engine: "codex" } })
  const transport = eventBus()
  const stop = await serveChatClient(owner, transport)
  const remote = new RemoteChatClient(transport)
  const file = {
    root: "/selected-project",
    path: "中文 #1.txt",
    file_name: "中文 #1.txt",
    match_type: "file",
    score: 0,
    indices: null
  }
  initialFiles.mockResolvedValue([file])
  try {
    await remote.connect()
    expect(await remote.fuzzyFileSearch({ query: "", roots: ["/selected-project"] })).toEqual({ files: [file] })
    expect(initialFiles).toHaveBeenCalledWith("/selected-project", "")
    expect(fake.fileSearches).toEqual([])
    expect((await remote.fuzzyFileSearch({ query: "client", roots: ["/selected-project"] })).files).toMatchObject([
      { root: "/selected-project", path: "中文 #1.txt" }
    ])
    expect(initialFiles).toHaveBeenCalledWith("/selected-project", "client")
    expect(fake.fileSearches).toEqual([])
  } finally {
    initialFiles.mockReset()
    remote.disconnect()
    stop()
    owner.disconnect()
  }
})

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
    expect(remote.state.forkOrigins[child]).toEqual({ sourceId: source, boundaryTurnId: "turn-1" })
    expect((await remote.readThreadSummary(source))?.sessionId).toBe(source)
    expect(port.started).toEqual(["codex"])
    await remote.stopSession(source)
    expect(owner.state.sessions[source]?.attached).toBe(false)
    expect(remote.state.sessions[source]?.attached).toBe(false)
    expect(owner.session(child).attached).toBe(true)
    expect((await port.agents()).map(agent => agent.agentId)).toEqual(["codex"])
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

test("an existing floating client reconnects after its main window bridge is replaced", async () => {
  const fake = createFakeAgent()
  const port = new FakeHubPort(() => fake.app)
  const owner = new CodexClient(async () => port, { agentId: "codex", launch: { engine: "codex" } })
  const transport = eventBus()
  let stop = await serveChatClient(owner, transport)
  const remote = new RemoteChatClient(transport)
  try {
    await remote.connect()
    const id = await remote.newSession("/tmp/floating-reconnect")
    stop()
    await new Promise<void>(resolve => queueMicrotask(resolve))
    expect(remote.state.connection).toBe("disconnected")
    stop = await serveChatClient(owner, transport)
    await remote.connect()
    expect(remote.state.connection).toBe("ready")
    expect(remote.session(id).cwd).toBe("/tmp/floating-reconnect")
    expect(port.started).toEqual(["codex"])
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

test("draft handoff keeps its model and only the new owner can discard it", async () => {
  const fake = createFakeAgent()
  const port = new FakeHubPort(() => fake.app)
  const owner = new CodexClient(async () => port, { agentId: "codex", launch: { engine: "codex" } })
  const transport = eventBus()
  const stop = await serveChatClient(owner, transport)
  const remote = new RemoteChatClient(transport)
  try {
    await remote.connect()
    const id = await owner.prepareDraft("main", "/tmp/draft-handoff")
    await owner.setConfig(id, "model", "chosen-model")
    await remote.transferDraft(id, "chat")
    await owner.discardDraft("main")
    expect(remote.state.draftSessions[id]).toBe("chat")
    expect(await remote.prepareDraft("chat", "/tmp/draft-handoff")).toBe(id)
    expect(remote.session(id).configOptions[0]?.currentValue).toBe("chosen-model")
    await remote.discardDraft("chat")
    expect(fake.deleted.has(id)).toBe(true)
    expect(owner.state.sessions[id]).toBeUndefined()
  } finally {
    remote.disconnect()
    stop()
    owner.disconnect()
  }
})

const codexModel = "gpt-6-astra"
const deepseekModel = "gateway:deepseek:deepseek-flash"

test("floating model selection and restore use only the floating slot", async () => {
  const f = await providerWindows()
  try {
    f.owner.setModelSelections({ main: codexModel, chat: codexModel })
    const choices: unknown[] = []
    f.owner.onConfirmedModel((...args) => choices.push(args))
    const draft = await f.remote.prepareDraft("chat", "/tmp/floating-choice")
    await f.remote.setConfig(draft, "model", deepseekModel)
    await f.owner.open("h1", "/tmp/main-restore")
    await f.remote.open("h2", "/tmp/floating-restore")
    expect(f.fake.modelHints.get("h1")).toBe(codexModel)
    expect(f.fake.modelHints.get("h2")).toBe(deepseekModel)
    expect(choices).toEqual([["chat", deepseekModel]])
  } finally {
    f.dispose()
  }
})

function providerOptions(model: string | null): acp.SessionConfigOption[] {
  return [
    {
      configId: "model",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: model ?? codexModel,
      options: [
        { groupId: "chatgpt", name: "ChatGPT", options: [{ value: codexModel, name: "GPT-6-Astra" }] },
        { groupId: "deepseek", name: "DeepSeek", options: [{ value: deepseekModel, name: "DeepSeek-Flash" }] }
      ]
    }
  ]
}

async function providerWindows() {
  const fake = createFakeAgent()
  // Match the adapter's catalog response, including the provider-qualified model ID.
  fake.sessionOptions.current = providerOptions
  const port = new FakeHubPort(() => fake.app)
  const requests = vi.spyOn(port, "acpRequest")
  const owner = new CodexClient(async () => port, { agentId: "codex", launch: { engine: "codex" } })
  const transport = eventBus()
  const stop = await serveChatClient(owner, transport)
  const remote = new RemoteChatClient(transport)
  await remote.connect()
  return {
    fake,
    port,
    requests,
    owner,
    remote,
    dispose() {
      remote.disconnect()
      stop()
      owner.disconnect()
      requests.mockRestore()
    }
  }
}

for (const surface of ["main", "chat"] as const) {
  test(`${surface} switches Codex to DeepSeek and back without changing the other window's session`, async () => {
    const f = await providerWindows()
    try {
      const window = surface === "main" ? f.owner : f.remote
      const id = await window.newSession("/tmp/provider-target")
      const other = await f.owner.newSession("/tmp/provider-other")
      const seen: unknown[] = []
      f.owner.onSessionModel((...change) => seen.push(change))
      for (const model of [deepseekModel, codexModel]) {
        await window.setConfig(id, "model", model)
        expect(f.fake.configChanges.at(-1)).toBe(model)
        expect(f.owner.session(id).configOptions[0]?.currentValue).toBe(model)
        expect(f.remote.session(id).configOptions[0]?.currentValue).toBe(model)
        expect(f.owner.session(other).configOptions[0]?.currentValue).toBe(codexModel)
        expect(f.remote.session(other).configOptions[0]?.currentValue).toBe(codexModel)
        expect(seen.at(-1)).toEqual([id, model, model === deepseekModel])
      }
      expect(
        f.requests.mock.calls
          .filter(([, method]) => method === "session/set_config_option")
          .map(([, , params]) => params)
      ).toEqual([
        { sessionId: id, configId: "model", type: "id", value: deepseekModel },
        { sessionId: id, configId: "model", type: "id", value: codexModel }
      ])
      expect(f.port.started).toEqual(["codex"])
    } finally {
      f.dispose()
    }
  })

  test(`${surface} waits for provider selection before sending and synchronizes the pending state`, async () => {
    const f = await providerWindows()
    const gate = Promise.withResolvers<void>()
    const entered = Promise.withResolvers<void>()
    try {
      const window = surface === "main" ? f.owner : f.remote
      const id = await window.newSession("/tmp/provider-pending")
      f.fake.configDelay.current = async () => {
        entered.resolve()
        await gate.promise
      }
      const selecting = window.setConfig(id, "model", deepseekModel)
      await entered.promise
      await vi.waitFor(() => expect(f.remote.state.configPending[id]).toBe(true))
      expect(f.owner.state.configPending[id]).toBe(true)
      expect(f.remote.session(id).configOptions[0]?.currentValue).toBe(codexModel)
      const sending = window.prompt(id, [{ type: "text", text: "Provider selection test" }])
      await new Promise<void>(resolve => setTimeout(resolve, 0))
      expect(f.requests.mock.calls.some(([, method]) => method === "session/prompt")).toBe(false)
      gate.resolve()
      await Promise.all([selecting, sending])
      expect(f.remote.session(id).configOptions[0]?.currentValue).toBe(deepseekModel)
      await vi.waitFor(() => expect(Boolean(f.remote.state.configPending[id])).toBe(false))
      expect(
        f.requests.mock.calls
          .filter(([, method]) => ["session/set_config_option", "session/prompt"].includes(method))
          .map(([, method, params]) => [method, params])
      ).toEqual([
        ["session/set_config_option", { sessionId: id, configId: "model", type: "id", value: deepseekModel }],
        [
          "session/prompt",
          {
            sessionId: id,
            prompt: [{ type: "text", text: "Provider selection test" }],
            _meta: { codex: { messageSentAt: expect.any(Number) } }
          }
        ]
      ])
      await vi.waitFor(() => expect(f.owner.session(id).state).toBe("idle"))
    } finally {
      gate.resolve()
      f.dispose()
    }
  })

  test(`${surface} preserves Codex and rejects a queued send when switching to DeepSeek fails`, async () => {
    const f = await providerWindows()
    const gate = Promise.withResolvers<void>()
    const entered = Promise.withResolvers<void>()
    try {
      const window = surface === "main" ? f.owner : f.remote
      const id = await window.newSession("/tmp/provider-failure")
      f.fake.configDelay.current = async () => {
        entered.resolve()
        await gate.promise
        throw new Error("DeepSeek unavailable")
      }
      const selecting = window.setConfig(id, "model", deepseekModel)
      await entered.promise
      const sending = window.prompt(id, [{ type: "text", text: "Do not send on Codex" }])
      const results = Promise.allSettled([selecting, sending])
      await new Promise<void>(resolve => setTimeout(resolve, 0))
      gate.resolve()
      expect((await results).map(result => result.status)).toEqual(["rejected", "rejected"])
      expect(f.requests.mock.calls.some(([, method]) => method === "session/prompt")).toBe(false)
      expect(f.owner.session(id).configOptions[0]?.currentValue).toBe(codexModel)
      expect(f.remote.session(id).configOptions[0]?.currentValue).toBe(codexModel)
      await vi.waitFor(() => expect(Boolean(f.remote.state.configPending[id])).toBe(false))
      f.fake.configDelay.current = null
      await window.setConfig(id, "model", deepseekModel)
      expect(f.remote.session(id).configOptions[0]?.currentValue).toBe(deepseekModel)
    } finally {
      gate.resolve()
      f.dispose()
    }
  })

  test(`${surface} hands off a DeepSeek draft and can switch it back to Codex before sending`, async () => {
    const f = await providerWindows()
    try {
      const window = surface === "main" ? f.owner : f.remote
      const target = surface === "main" ? "chat" : "main"
      const otherWindow = target === "main" ? f.owner : f.remote
      const native = await window.prepareDraft(surface, "/tmp/provider-draft", codexModel)
      const deepseek = await window.prepareDraft(surface, "/tmp/provider-draft", deepseekModel)
      expect(f.fake.deleted.has(native)).toBe(true)
      expect(f.fake.modelHints.get(deepseek)).toBe(deepseekModel)
      await window.transferDraft(deepseek, target)
      expect(await otherWindow.prepareDraft(target, "/tmp/provider-draft")).toBe(deepseek)
      expect(otherWindow.session(deepseek).configOptions[0]?.currentValue).toBe(deepseekModel)
      const restored = await otherWindow.prepareDraft(target, "/tmp/provider-draft", codexModel)
      expect(f.fake.modelHints.get(restored)).toBe(codexModel)
      expect(f.fake.deleted.has(deepseek)).toBe(true)
      expect(f.owner.state.draftSessions[restored]).toBe(target)
      expect(f.remote.session(restored).configOptions[0]?.currentValue).toBe(codexModel)
      expect(f.fake.configChanges).toEqual([])
    } finally {
      f.dispose()
    }
  })
}

test("floating project views use the owner's full session list and receive mutations", async () => {
  const fake = createFakeAgent()
  const port = new FakeHubPort(() => fake.app)
  const owner = new CodexClient(async () => port, { agentId: "codex", launch: { engine: "codex" } })
  const transport = eventBus()
  const stop = await serveChatClient(owner, transport)
  const remote = new RemoteChatClient(transport)
  try {
    await remote.connect()
    expect((await remote.listProjectThreads("/tmp/one")).map(thread => thread.sessionId)).toEqual(["h1"])
    expect(fake.fullListRequests).toEqual([undefined])
    await owner.renameSession("h1", "Renamed")
    expect((await remote.listProjectThreads("/tmp/one"))[0]?.title).toBe("Renamed")
    expect(fake.fullListRequests).toHaveLength(1)
  } finally {
    remote.disconnect()
    stop()
    owner.disconnect()
  }
})
