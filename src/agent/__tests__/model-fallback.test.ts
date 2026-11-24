import { RequestError } from "@agentclientprotocol/sdk/experimental/v2/unstable"
import { CodexClient } from "@alwith/module-chat/client"
import { createFakeAgent, FakeHubPort } from "@alwith/module-chat/testing"
import { expect, test, vi } from "vitest"

const CONFIGURED_MODEL = "gateway:deepseek:test-model"
const SECOND_MODEL = "gateway:deepseek:second-model"

function fixture(
  resolveModel: (model: string | null) => Promise<string | null> = async (model) => model ?? CONFIGURED_MODEL
) {
  const fake = createFakeAgent()
  fake.gateways.set("deepseek", {
    providerId: "openai",
    apiType: "openai",
    baseUrl: "https://gateway.test/v1",
    _meta: {
      codex: { id: "deepseek", mode: "catalog" },
      alwith: { models: [{ id: CONFIGURED_MODEL }, { id: SECOND_MODEL }] }
    }
  })
  const port = new FakeHubPort(() => fake.app)
  const requests = vi.spyOn(port, "acpRequest")
  const client = new CodexClient(() => Promise.resolve(port), {
    agentId: "codex",
    launch: { engine: "codex" },
    resolveModel
  })
  return { fake, port, requests, client }
}

test.each(["main", "chat"] as const)("%s cold resumes replace a missing model on the same session", async (owner) => {
  const f = fixture()
  f.fake.persistedModels.set("old", "gateway:removed:model")
  try {
    await f.client.connect()
    await f.client.open("old", "/tmp/original", owner)
    expect(f.client.session("old")).toMatchObject({ attached: true, readOnly: false, error: null })
    expect(f.fake.persistedModels.get("old")).toBe(CONFIGURED_MODEL)
    expect(f.fake.modelHints.get("old")).toBe(CONFIGURED_MODEL)
    expect(f.client.session("old").items.length).toBeGreaterThan(0)
    expect(f.client.state.modelRecovery.old).toBeUndefined()
    expect(f.client.state.sessionWindows.old).toBe(owner)
    expect(f.requests.mock.calls.filter((call) => call[1] === "session/resume")).toHaveLength(2)
    expect(
      f.requests.mock.calls.some((call) => ["session/new", "session/prompt", "session/delete"].includes(call[1]))
    ).toBe(false)
  } finally {
    f.client.disconnect()
  }
})

test("an unavailable known route also falls back without changing another session", async () => {
  let available = true
  const f = fixture(async (model) => {
    if (!available && model !== null) throw new Error("The selected model connection is unavailable")
    return model ?? CONFIGURED_MODEL
  })
  try {
    await f.client.connect()
    await f.client.open("old", "/tmp/old")
    await f.client.stopSession("old")
    await f.client.open("other", "/tmp/other")
    available = false
    await f.client.open("old", "/tmp/old")
    expect(f.client.session("old")).toMatchObject({ attached: true, readOnly: false })
    expect(f.fake.modelHints.get("old")).toBe(CONFIGURED_MODEL)
    expect(f.fake.modelHints.get("other")).toBeNull()
  } finally {
    f.client.disconnect()
  }
})

test("revocation detaches without read-only and the next open automatically selects a model", async () => {
  const f = fixture()
  try {
    await f.client.connect()
    await f.client.open("revoked", "/tmp/project")
    f.client.markAccountModelsUnavailable(["revoked"])
    expect(f.client.session("revoked")).toMatchObject({ attached: false, readOnly: false, error: null })
    await f.client.open("revoked", "/tmp/project")
    expect(f.client.session("revoked")).toMatchObject({ attached: true, readOnly: false, error: null })
    expect(f.client.state.modelRecovery.revoked).toBeUndefined()
    expect(f.requests.mock.calls.findLast((call) => call[1] === "session/resume")?.[2]).toMatchObject({
      sessionId: "revoked",
      configOptions: [{ configId: "model", type: "id", value: CONFIGURED_MODEL }]
    })
  } finally {
    f.client.disconnect()
  }
})

test("recovery uses the host's configured model order without querying the native catalog", async () => {
  const resolve = vi.fn(async (model: string | null) => model ?? SECOND_MODEL)
  const f = fixture(resolve)
  f.fake.persistedModels.set("old", "gateway:removed:model")
  try {
    await f.client.connect()
    await f.client.open("old", "/tmp/project")
    expect(f.fake.modelHints.get("old")).toBe(SECOND_MODEL)
    expect(resolve).toHaveBeenCalledWith(null, "session")
    expect(f.requests.mock.calls.some((call) => call[1] === "_codex/models_list")).toBe(false)
    expect(f.client.session("old")).toMatchObject({ attached: true, readOnly: false })
  } finally {
    f.client.disconnect()
  }
})

test("an empty catalog preserves history without marking it read-only and can be retried", async () => {
  let empty = true
  const f = fixture(async (model) => model ?? (empty ? null : CONFIGURED_MODEL))
  f.fake.persistedModels.set("old", "gateway:removed:model")
  try {
    await f.client.connect()
    await expect(f.client.open("old", "/tmp/project")).rejects.toThrow("No available models")
    expect(f.client.session("old")).toMatchObject({ attached: false, readOnly: false, restoring: false })
    expect(f.client.session("old").items.length).toBeGreaterThan(0)
    empty = false
    await f.client.open("old", "/tmp/project")
    expect(f.client.session("old")).toMatchObject({ attached: true, readOnly: false, error: null })
  } finally {
    f.client.disconnect()
  }
})

test("a persistent model error retries only once and never marks the session read-only", async () => {
  const f = fixture()
  f.fake.resumeResponse.current = () =>
    Promise.reject(RequestError.invalidParams(undefined, "The selected model connection is unavailable"))
  try {
    await f.client.connect()
    await expect(f.client.open("old", "/tmp/project")).rejects.toThrow("unavailable")
    expect(f.requests.mock.calls.filter((call) => call[1] === "session/resume")).toHaveLength(2)
    expect(f.client.session("old")).toMatchObject({ attached: false, readOnly: false, restoring: false })
  } finally {
    f.client.disconnect()
  }
})

test.each(["Rate limited", "Network timeout"])("%s never switches models", async (message) => {
  const f = fixture()
  f.fake.resumeResponse.current = () => Promise.reject(RequestError.internalError(undefined, message))
  try {
    await f.client.connect()
    await expect(f.client.open("old", "/tmp/project")).rejects.toThrow(message)
    expect(f.client.state.modelRecovery.old).toBeUndefined()
    expect(f.client.session("old").readOnly).toBe(false)
    expect(f.requests.mock.calls.filter((call) => call[1] === "session/resume")).toHaveLength(1)
    expect(f.requests.mock.calls.some((call) => call[1] === "_codex/models_list")).toBe(false)
  } finally {
    f.client.disconnect()
  }
})

test("only another client's active writer produces a read-only conversation", async () => {
  const f = fixture()
  f.fake.resumeResponse.current = () =>
    Promise.reject(RequestError.invalidRequest({ reason: "thread_active_writer" }, "Active writer"))
  try {
    await f.client.connect()
    await f.client.open("locked", "/tmp/project")
    expect(f.client.session("locked")).toMatchObject({ attached: false, readOnly: true, error: null })
    expect(f.requests.mock.calls.some((call) => call[1] === "_codex/models_list")).toBe(false)
    expect(f.client.state.modelRecovery.locked).toBeUndefined()
  } finally {
    f.client.disconnect()
  }
})

test("a lock discovered after automatic model selection stays read-only", async () => {
  const f = fixture()
  f.fake.persistedModels.set("locked", "gateway:removed:model")
  f.fake.resumeResponse.current = () =>
    Promise.reject(RequestError.invalidRequest({ reason: "thread_active_writer" }, "Active writer"))
  try {
    await f.client.connect()
    await f.client.open("locked", "/tmp/project")
    expect(f.client.session("locked")).toMatchObject({ attached: false, readOnly: true, error: null })
    expect(f.requests.mock.calls.filter((call) => call[1] === "session/resume")).toHaveLength(2)
  } finally {
    f.client.disconnect()
  }
})

test("an account change during model discovery never resumes with the stale selection", async () => {
  let revoke = false
  const f = fixture(async (model) => {
    if (model === null && revoke) {
      revoke = false
      f.client.markAccountModelsUnavailable(["old"])
    }
    return model ?? CONFIGURED_MODEL
  })
  try {
    await f.client.connect()
    await f.client.open("old", "/tmp/project")
    f.client.markAccountModelsUnavailable(["old"])
    revoke = true
    const requests = f.requests.mock.calls.filter((call) => call[1] === "session/resume").length
    await expect(f.client.open("old", "/tmp/project")).rejects.toThrow("account changed")
    expect(f.requests.mock.calls.filter((call) => call[1] === "session/resume")).toHaveLength(requests)
    expect(f.client.session("old")).toMatchObject({ attached: false, readOnly: false })
    await f.client.open("old", "/tmp/project")
    expect(f.client.session("old")).toMatchObject({ attached: true, readOnly: false })
  } finally {
    f.client.disconnect()
  }
})
