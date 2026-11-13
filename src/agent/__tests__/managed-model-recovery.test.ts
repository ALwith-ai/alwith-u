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
    expect(client.state.sessions["old-account"]).toMatchObject({ attached: false, readOnly: true, restoring: false })
    expect(client.state.sessions["old-account"]?.items.length).toBeGreaterThan(0)
    expect(fake.historyRequests).toHaveLength(1)
    await expect(client.resumeAccountModel("old-account", null)).rejects.toThrow(/Cannot resume|account changed/)
    expect(client.state.sessions["old-account"]).toMatchObject({ attached: false, readOnly: true })
    expect(fake.deleted.size).toBe(1)
    fake.resumeResponse.current = null
    await client.resumeAccountModel("old-account", null)
    expect(client.state.sessions["old-account"]).toMatchObject({ attached: true, readOnly: false, error: null })
    expect(fake.modelHints.get("old-account")).toBe("gpt-6.1-sol")
    expect(fake.deleted.size).toBe(2)
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
      error: { stopReason: "account_model_required" }
    })
    await fake.pushUpdate(id, { sessionUpdate: "state_update", state: "idle", stopReason: "cancelled" })
    await vi.waitFor(() => expect(client.session(id).error).toBeNull())
    expect(client.state.accountModelRecovery[id]).toBe(true)
    await client.resumeAccountModel(id, null)
    expect(client.state.accountModelRecovery[id]).toBeUndefined()
    expect(client.session(id)).toMatchObject({ attached: true, readOnly: false, error: null })
    expect(fake.deleted.size).toBe(1)
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
    expect(client.state.accountModelRecovery[id]).toBe(true)
    expect(client.session(id)).toMatchObject({ attached: false, readOnly: true })
  } finally {
    client.disconnect()
  }
})

test("authentication recovery preserves error details and accepts an explicit gateway without login", async () => {
  const fake = createFakeAgent()
  const port = new FakeHubPort(() => fake.app)
  const requests = vi.spyOn(port, "acpRequest")
  const client = new CodexClient(() => Promise.resolve(port), { agentId: "codex", launch: { engine: "codex" } })
  fake.resumeResponse.current = () =>
    Promise.reject(RequestError.authRequired({ source: "gateway" }, "Gateway authorization expired"))
  try {
    await client.connect()
    await client.open("gateway-recovery", "/tmp/project")
    expect(client.session("gateway-recovery").error?.error).toMatchObject({
      code: -32000,
      message: "Authentication required: Gateway authorization expired",
      data: { source: "gateway" }
    })
    await expect(client.resumeAccountModel("gateway-recovery", null)).rejects.toThrow(/Select a model/)
    await port.acpRequest("codex", "providers/set", {
      providerId: "openai",
      apiType: "openai",
      baseUrl: "https://gateway.example.test/v1",
      _meta: {
        codex: { id: "deepseek", name: "Gateway", mode: "catalog", bearerToken: "test-only" },
        alwith: { models: [{ id: "test-model", label: "Test model" }] }
      }
    })
    fake.resumeResponse.current = null
    await client.resumeAccountModel("gateway-recovery", "gateway:deepseek:test-model")
    expect(client.session("gateway-recovery")).toMatchObject({ attached: true, error: null })
    expect(requests.mock.calls.findLast((call) => call[1] === "session/resume")?.[2]).toMatchObject({
      sessionId: "gateway-recovery",
      _meta: { alwith: { model: "gateway:deepseek:test-model", accountModelSelection: true } }
    })
    expect(requests.mock.calls.some((call) => ["auth/login", "session/prompt", "session/new"].includes(call[1]))).toBe(
      false
    )
  } finally {
    client.disconnect()
  }
})

test.each(["The selected provider connection or model is unavailable", "The selected model connection is unavailable"])(
  "a missing connection remains readable and can be reselected: %s",
  async (message) => {
    const fake = createFakeAgent()
    const port = new FakeHubPort(() => fake.app)
    const client = new CodexClient(() => Promise.resolve(port), { agentId: "codex", launch: { engine: "codex" } })
    fake.resumeResponse.current = () => Promise.reject(RequestError.invalidParams(undefined, message))
    try {
      await client.connect()
      await client.open("missing-provider", "/tmp/project")
      expect(client.session("missing-provider")).toMatchObject({ attached: false, readOnly: true, restoring: false })
      expect(client.session("missing-provider").items.length).toBeGreaterThan(0)
      expect(client.state.accountModelRecovery["missing-provider"]).toBe(true)
      await expect(client.resumeAccountModel("missing-provider", "gpt-6.1-sol")).rejects.toThrow()
      expect(client.session("missing-provider").attached).toBe(false)
      fake.resumeResponse.current = null
      await client.resumeAccountModel("missing-provider", "gpt-6.1-sol")
      expect(client.session("missing-provider")).toMatchObject({ attached: true, readOnly: false, error: null })
      expect(client.state.accountModelRecovery["missing-provider"]).toBeUndefined()
    } finally {
      client.disconnect()
    }
  }
)
