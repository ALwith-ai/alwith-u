import { RequestError } from "@agentclientprotocol/sdk/experimental/v2/unstable"
import { expect, test, vi } from "vitest"

import { CodexClient } from "../client"
import { createFakeAgent } from "./fake-agent"
import { FakeHubPort } from "./fake-runtime-client"

test("authentication failure preserves history and resumes the same session after login", async () => {
  const fake = createFakeAgent()
  const port = new FakeHubPort(() => fake.app)
  const client = new CodexClient(() => Promise.resolve(port), { agentId: "codex", launch: { engine: "codex" } })
  fake.resumeResponse.current = () => Promise.reject(RequestError.authRequired())
  fake.app.onRequest("auth/login", () => {
    fake.resumeResponse.current = null
    return {}
  })
  try {
    await client.connect()
    await client.open("expired-login", "/tmp/project")
    expect(client.session("expired-login")).toMatchObject({
      attached: false,
      restoring: false,
      readOnly: false,
      error: { error: { code: -32000, message: "Authentication required" } }
    })
    expect(client.session("expired-login").items.length).toBeGreaterThan(0)
    await client.login("chat-gpt")
    await client.open("expired-login", "/tmp/project")
    expect(client.session("expired-login")).toMatchObject({ attached: true, error: null })
    expect(fake.deleted.size).toBe(0)
  } finally {
    client.disconnect()
  }
})

test("a history read failure does not hide the authentication recovery", async () => {
  const fake = createFakeAgent()
  const port = new FakeHubPort(() => fake.app)
  const client = new CodexClient(() => Promise.resolve(port), { agentId: "codex", launch: { engine: "codex" } })
  fake.resumeResponse.current = () => Promise.reject(RequestError.authRequired())
  fake.historyResponse.current = () => {
    throw RequestError.invalidRequest(undefined, "History unavailable")
  }
  try {
    await client.connect()
    await client.open("expired-login", "/tmp/project")
    expect(client.session("expired-login")).toMatchObject({
      attached: false,
      restoring: false,
      error: { error: { code: -32000 } }
    })
    expect(client.state.historyPages["expired-login"]?.error).toContain("History unavailable")
  } finally {
    client.disconnect()
  }
})

test("revoked account sessions remain readable and need an explicit model before resuming", async () => {
  const fake = createFakeAgent()
  const port = new FakeHubPort(() => fake.app)
  const requests = vi.spyOn(port, "acpRequest")
  const client = new CodexClient(() => Promise.resolve(port), { agentId: "codex", launch: { engine: "codex" } })
  fake.resumeResponse.current = () => {
    return Promise.reject(
      RequestError.invalidRequest(undefined, "The ALwith account changed. Select a model before sending")
    )
  }
  try {
    await client.connect()
    await client.open("old-account", "/tmp/project")
    expect(client.state.sessions["old-account"]).toMatchObject({
      attached: false,
      readOnly: true,
      restoring: false,
      error: null
    })
    expect(client.state.sessions["old-account"]?.items.length).toBeGreaterThan(0)
    expect(fake.historyRequests).toHaveLength(1)
    await expect(client.resumeModel("old-account", "gpt-6.1-sol")).rejects.toThrow(/Cannot resume|account changed/)
    expect(client.state.sessions["old-account"]).toMatchObject({ attached: false, readOnly: true })
    expect(fake.deleted.size).toBe(0)
    fake.resumeResponse.current = null
    await client.resumeModel("old-account", "gpt-6.1-sol")
    expect(client.state.sessions["old-account"]).toMatchObject({ attached: true, readOnly: false, error: null })
    expect(fake.modelHints.get("old-account")).toBe("gpt-6.1-sol")
    expect(fake.deleted.size).toBe(0)
    expect(requests.mock.calls.findLast((call) => call[1] === "session/resume")?.[2]).toMatchObject({
      sessionId: "old-account",
      _meta: { alwith: { model: "gpt-6.1-sol", accountModelSelection: true } }
    })
    expect(requests.mock.calls.some((call) => call[1] === "session/prompt")).toBe(false)
  } finally {
    client.disconnect()
  }
})

test("an already open conversation immediately exposes recovery after account revocation", async () => {
  const fake = createFakeAgent()
  const port = new FakeHubPort(() => fake.app)
  const client = new CodexClient(() => Promise.resolve(port), { agentId: "codex", launch: { engine: "codex" } })
  try {
    await client.connect()
    const id = await client.newSession("/tmp/project")
    client.markAccountModelsUnavailable([id])
    expect(client.session(id)).toMatchObject({
      attached: false,
      readOnly: true,
      error: null
    })
    await fake.pushUpdate(id, { sessionUpdate: "state_update", state: "idle", stopReason: "cancelled" })
    await vi.waitFor(() => expect(client.session(id).error).toBeNull())
    expect(client.state.modelRecovery[id]).toBe(true)
    await client.resumeModel(id, "gpt-6.1-sol")
    expect(client.state.modelRecovery[id]).toBeUndefined()
    expect(client.session(id)).toMatchObject({ attached: true, readOnly: false, error: null })
    expect(fake.deleted.size).toBe(0)
  } finally {
    client.disconnect()
  }
})

test("revocation received before session/new returns remains visible after the new session is published", async () => {
  const fake = createFakeAgent()
  const port = new FakeHubPort(() => fake.app)
  const client = new CodexClient(() => Promise.resolve(port), { agentId: "codex", launch: { engine: "codex" } })
  const request = port.acpRequest.bind(port)
  port.acpRequest = async <Result>(...args: Parameters<FakeHubPort["acpRequest"]>): Promise<Result> => {
    const response = await request<Result>(...args)
    if (args[1] === "session/new") client.markAccountModelsUnavailable([(response as { sessionId: string }).sessionId])
    return response
  }
  try {
    await client.connect()
    const id = await client.newSession("/tmp/project")
    expect(client.state.modelRecovery[id]).toBe(true)
    expect(client.session(id)).toMatchObject({ attached: false, readOnly: true })
  } finally {
    client.disconnect()
  }
})

test("account revocation preserves an existing execution error", async () => {
  const fake = createFakeAgent()
  const port = new FakeHubPort(() => fake.app)
  const client = new CodexClient(() => Promise.resolve(port), { agentId: "codex", launch: { engine: "codex" } })
  try {
    await client.connect()
    const id = await client.newSession("/tmp/project")
    const error = { stopReason: "error" as const, error: { code: -32603, message: "Execution failed" }, meta: null }
    await fake.pushUpdate(id, { sessionUpdate: "state_update", state: "idle", ...error })
    await vi.waitFor(() => expect(client.session(id).error).toEqual(error))
    client.markAccountModelsUnavailable([id])
    expect(client.session(id).error).toEqual(error)
    expect(client.state.modelRecovery[id]).toBe(true)
  } finally {
    client.disconnect()
  }
})

test.each(["provider", "model"])(
  "a cold resume on a deleted %s reads history and explicitly resumes the original conversation",
  async (removed) => {
    const fake = createFakeAgent()
    fake.persistedModels.set("removed-provider", "gateway:removed:model")
    const port = new FakeHubPort(() => fake.app)
    const requests = vi.spyOn(port, "acpRequest")
    const client = new CodexClient(() => Promise.resolve(port), { agentId: "codex", launch: { engine: "codex" } })
    try {
      await client.connect()
      if (removed === "model")
        await port.acpRequest("codex", "providers/set", {
          providerId: "openai",
          apiType: "openai",
          baseUrl: "https://gateway.example.test/v1",
          _meta: {
            codex: { id: "removed", mode: "catalog" },
            alwith: { models: [{ id: "gateway:removed:replacement" }] }
          }
        })
      // The existing advertised native catalog is retained when the startup draft goes away.
      const draft = await client.prepareDraft("main", "/tmp/project")
      await client.discardDraft(draft)
      const creates = requests.mock.calls.filter((call) => call[1] === "session/new").length
      expect(client.state.nativeModels).toContainEqual({ id: "gpt-6.1-sol", label: "GPT-6.1 Sol" })
      await client.open("removed-provider", "/tmp/project")
      expect(client.session("removed-provider")).toMatchObject({
        attached: false,
        restoring: false,
        readOnly: true,
        error: null
      })
      expect(client.session("removed-provider").items).toHaveLength(2)
      expect(fake.historyRequests).toHaveLength(1)
      expect(client.state.modelRecovery["removed-provider"]).toBe(true)
      expect(fake.persistedModels.get("removed-provider")).toBe("gateway:removed:model")
      await client.resumeModel("removed-provider", "gpt-6.1-sol")
      expect(client.session("removed-provider")).toMatchObject({ attached: true, readOnly: false, error: null })
      expect(client.session("removed-provider").items).toHaveLength(2)
      expect(client.state.modelRecovery["removed-provider"]).toBeUndefined()
      expect(fake.persistedModels.get("removed-provider")).toBe("gpt-6.1-sol")
      expect(requests.mock.calls.filter((call) => call[1] === "session/new")).toHaveLength(creates)
      expect(requests.mock.calls.findLast((call) => call[1] === "session/resume")?.[2]).toMatchObject({
        sessionId: "removed-provider",
        _meta: { alwith: { model: "gpt-6.1-sol" } }
      })
      expect(requests.mock.calls.some((call) => call[1] === "session/prompt")).toBe(false)
    } finally {
      client.disconnect()
    }
  }
)

test("a known route rejected before resume still loads history without borrowing the slot's model", async () => {
  const fake = createFakeAgent()
  const port = new FakeHubPort(() => fake.app)
  let available = true
  const client = new CodexClient(() => Promise.resolve(port), {
    agentId: "codex",
    launch: { engine: "codex" },
    resolveModel: async (model) => {
      if (!available && model !== null) throw new Error("The selected provider connection or model is unavailable")
      return model
    }
  })
  try {
    await client.connect()
    await client.open("warm", "/tmp/original")
    await client.stopSession("warm")
    client.setModelSelections({ main: "another-model", chat: null })
    available = false
    const reads = fake.historyRequests.length
    await client.open("warm", "/tmp/original")
    expect(fake.historyRequests).toHaveLength(reads + 1)
    expect(client.session("warm").items).toHaveLength(2)
    expect(client.state.modelRecovery.warm).toBe(true)
    expect(client.session("warm")).toMatchObject({ attached: false, readOnly: true, restoring: false })
    expect(fake.modelHints.get("warm")).toBeNull()
    expect(fake.deleted.size).toBe(0)
  } finally {
    client.disconnect()
  }
})

test("history read errors preserve model recovery and retrying a removed model never replaces it silently", async () => {
  const fake = createFakeAgent()
  fake.persistedModels.set("removed-model", "gateway:removed:model")
  fake.historyResponse.current = () => {
    throw RequestError.invalidRequest(undefined, "History unavailable")
  }
  const port = new FakeHubPort(() => fake.app)
  const client = new CodexClient(() => Promise.resolve(port), { agentId: "codex", launch: { engine: "codex" } })
  try {
    await client.connect()
    await client.open("removed-model", "/tmp/project")
    expect(client.state.historyPages["removed-model"]?.error).toContain("History unavailable")
    expect(client.state.modelRecovery["removed-model"]).toBe(true)
    expect(client.session("removed-model").restoring).toBe(false)
    await expect(client.resumeModel("removed-model", "gateway:removed:model")).rejects.toThrow()
    expect(client.state.modelRecovery["removed-model"]).toBe(true)
    expect(client.session("removed-model")).toMatchObject({ attached: false, readOnly: true, restoring: false })
    fake.historyResponse.current = null
    await client.resumeModel("removed-model", "gpt-6.1-sol")
    expect(client.state.modelRecovery["removed-model"]).toBeUndefined()
    expect(client.session("removed-model").items).toHaveLength(2)
  } finally {
    client.disconnect()
  }
})

test("model recovery stays with its own session when another conversation opens during the history read", async () => {
  const fake = createFakeAgent()
  fake.persistedModels.set("old", "gateway:removed:model")
  const pending = Promise.withResolvers<unknown>()
  fake.historyResponse.current = (params) =>
    params.sessionId === "old"
      ? pending.promise
      : {
          sessionId: params.sessionId,
          consistency: "live",
          revision: null,
          nextCursor: null,
          complete: true,
          turns: []
        }
  const port = new FakeHubPort(() => fake.app)
  const client = new CodexClient(() => Promise.resolve(port), { agentId: "codex", launch: { engine: "codex" } })
  try {
    await client.connect()
    const opening = client.open("old", "/tmp/old")
    await vi.waitFor(() => expect(fake.historyRequests).toHaveLength(1))
    await client.open("newer", "/tmp/newer")
    pending.resolve({
      sessionId: "old",
      consistency: "live",
      revision: null,
      nextCursor: null,
      complete: true,
      turns: []
    })
    await opening
    expect(client.state.modelRecovery.old).toBe(true)
    expect(client.state.modelRecovery.newer).toBeUndefined()
    expect(client.session("newer")).toMatchObject({ attached: true, readOnly: false })
    await expect(client.resumeModel("old", "")).rejects.toThrow("Select a model")
    expect(fake.deleted.size).toBe(0)
  } finally {
    pending.resolve(null)
    client.disconnect()
  }
})
