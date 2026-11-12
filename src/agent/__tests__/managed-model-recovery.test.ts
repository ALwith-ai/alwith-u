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
