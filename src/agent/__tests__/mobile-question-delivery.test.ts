import { asyncQuestionId } from "@alwith/module-chat/async-question-card"
import { CodexClient } from "@alwith/module-chat/client"
import { createFakeAgent, FakeHubPort } from "@alwith/module-chat/testing"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { create } from "zustand"

import type { MobilePrompt } from "@/features/mobile/actions"
import { initializeMobile } from "@/features/mobile/bridge"

type Listener = (event: { payload: MobilePrompt }) => void
const listeners = new Map<string, Listener>()
const publish = vi.fn<(snapshot: { questionTokens: Record<string, Record<string, string>> }) => Promise<void>>()
const receipt =
  vi.fn<(result: { status: string; clientRequestId: string; messageId: string | null }) => Promise<void>>()
const makeOrder = () => create(() => ({ ids: [] as string[] }))
let order: ReturnType<typeof makeOrder>
let client: CodexClient
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }))
vi.mock("@tauri-apps/api/event", () => ({ listen: (name: string, cb: Listener) => listeners.set(name, cb) }))
vi.mock("@/lib/client", () => ({
  get client() {
    return client
  }
}))
vi.mock("@/features/sessions/activity-order", () => ({
  get useActivityOrder() {
    return order
  }
}))
vi.mock("@/bindings", () => ({
  commands: { mobileSetActivitySessions: (...args: Parameters<typeof publish>) => publish(...args) }
}))
vi.mock("@alwith/module-mobile/commands", () => ({
  commands: { bridgePromptResult: (...args: Parameters<typeof receipt>) => receipt(...args) }
}))
vi.mock("@/lib/settings-store", () => ({ settingsStore: { get: () => false } }))
vi.mock("@/lib/background-errors", () => ({ reportBackgroundError: vi.fn() }))

let sessionId: string
let token: string
let port: FakeHubPort
let fake: ReturnType<typeof createFakeAgent>
const tokens = (): string[] => Object.values(publish.mock.lastCall?.[0].questionTokens[sessionId] ?? {})
function send(nonce: string): string {
  const clientRequestId = "question/" + token + "/" + nonce
  listeners.get("bridge:send-prompt")!({ payload: { sessionId, clientRequestId, deviceId: "phone", text: "A" } })
  return clientRequestId
}

beforeEach(async () => {
  publish.mockReset().mockResolvedValue(undefined)
  receipt.mockReset().mockResolvedValue(undefined)
  order = makeOrder()
  fake = createFakeAgent()
  port = new FakeHubPort(() => fake.app)
  client = new CodexClient(() => Promise.resolve(port), { agentId: "codex", launch: { engine: "codex" } })
  await client.connect()
  sessionId = await client.newSession("/fixture")
  order.setState({ ids: [sessionId] })
  await fake.pushUpdate(sessionId, {
    sessionUpdate: "agent_message",
    messageId: "q",
    content: [{ type: "text", text: "Where?" }],
    _meta: { codex: { turnId: "turn", delivery: "async", questions: [{ title: "Where?", options: ["A"] }] } }
  })
  await initializeMobile()
  await vi.waitFor(() => expect(tokens()).toHaveLength(1))
  token = tokens()[0]!
})

afterEach(() => client.disconnect())

const configRefusal = (): Error =>
  Object.assign(new Error("config/stale"), {
    data: { alwith: { configStale: { expected: 1, actual: 2, configOptions: [] } } }
  })

test("config refusal restores the original token before retrying the original answer", async () => {
  vi.spyOn(port, "acpRequest").mockRejectedValueOnce(configRefusal())
  let failedPublication = false
  publish.mockImplementation(({ questionTokens }) => {
    if (!failedPublication && Object.values(questionTokens[sessionId] ?? {}).includes(token)) {
      failedPublication = true
      return Promise.reject(new Error("Token publication interrupted"))
    }
    return Promise.resolve()
  })
  const first = send("first")
  await vi.waitFor(() =>
    expect(receipt).toHaveBeenCalledWith(expect.objectContaining({ clientRequestId: first, status: "rejected" }))
  )
  expect(failedPublication).toBe(true)
  expect(tokens()).toEqual([token])
  expect(Math.max(...publish.mock.invocationCallOrder)).toBeLessThan(Math.min(...receipt.mock.invocationCallOrder))
  const retry = send("retry")
  await vi.waitFor(() =>
    expect(receipt).toHaveBeenCalledWith(expect.objectContaining({ clientRequestId: retry, status: "accepted" }))
  )
  expect(fake.prompts).toHaveLength(1)
})

test("an unknown answer stays locked across reconnect and a matching echo repairs its receipt", async () => {
  vi.spyOn(port, "acpRequest").mockRejectedValueOnce(new Error("Receipt lost"))
  const request = send("uncertain")
  await vi.waitFor(() => expect(receipt).toHaveBeenCalledWith(expect.objectContaining({ status: "unknown" })))
  order.setState({ ids: [] })
  client.store.setState({ connection: "disconnected" })
  client.store.setState({ connection: "ready" })
  order.setState({ ids: [sessionId] })
  await vi.waitFor(() =>
    expect(publish.mock.lastCall?.[0]).toMatchObject({ sessionIds: [sessionId], questionTokens: {} })
  )
  expect(tokens()).toEqual([])
  send("concurrent")
  await vi.waitFor(() => expect(receipt).toHaveBeenCalledWith(expect.objectContaining({ status: "rejected" })))
  expect(fake.prompts).toHaveLength(0)
  await fake.pushUpdate(sessionId, {
    sessionUpdate: "user_message",
    messageId: "authoritative",
    content: [{ type: "text", text: "A" }],
    _meta: { mobile: { deviceId: "phone", clientRequestId: request } }
  })
  await vi.waitFor(() =>
    expect(receipt).toHaveBeenCalledWith(
      expect.objectContaining({ status: "accepted", clientRequestId: request, messageId: "authoritative" })
    )
  )
})

test.each(["next turn", "desktop answer"])("a late refusal cannot reopen the question after %s", async (change) => {
  const deferred = Promise.withResolvers<never>()
  const prompt = vi.spyOn(port, "acpRequest").mockImplementationOnce(() => deferred.promise)
  const request = send("first")
  await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(1))
  const concurrent = send("second")
  await vi.waitFor(() =>
    expect(receipt).toHaveBeenCalledWith(expect.objectContaining({ clientRequestId: concurrent, status: "rejected" }))
  )
  if (change === "next turn") {
    await fake.pushUpdate(sessionId, {
      sessionUpdate: "agent_message",
      messageId: "later",
      content: [{ type: "text", text: "Next" }],
      _meta: { codex: { turnId: "next" } }
    })
  } else {
    const reply = { questionItemId: asyncQuestionId("q", 0), question: "Where?", answer: "Desktop" }
    await fake.pushUpdate(sessionId, {
      sessionUpdate: "user_message",
      messageId: "desktop",
      content: [{ type: "text", text: "Desktop" }],
      _meta: { codex: { turnId: "turn", questionReply: reply } }
    })
  }
  await vi.waitFor(() =>
    expect(client.session(sessionId).items.some((i) => i.id === (change === "next turn" ? "later" : "desktop"))).toBe(
      true
    )
  )
  deferred.reject(configRefusal())
  await vi.waitFor(() =>
    expect(receipt).toHaveBeenCalledWith(expect.objectContaining({ clientRequestId: request, status: "rejected" }))
  )
  expect(tokens()).toEqual([])
  expect(prompt).toHaveBeenCalledTimes(1)
})

test("a matching agent echo confirms delivery even while the submission receipt is missing", async () => {
  const pending = Promise.withResolvers<never>()
  const prompt = vi.spyOn(port, "acpRequest").mockImplementationOnce(() => pending.promise)
  try {
    const request = send("missing-receipt")
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(1))
    for (const deviceId of ["other", "phone"]) {
      await fake.pushUpdate(sessionId, {
        sessionUpdate: "user_message",
        messageId: "echo-" + deviceId,
        content: [{ type: "text", text: "A" }],
        _meta: { mobile: { deviceId, clientRequestId: request } }
      })
    }
    await vi.waitFor(() =>
      expect(receipt).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          sessionId,
          deviceId: "phone",
          clientRequestId: request,
          messageId: "echo-phone",
          status: "accepted"
        })
      )
    )
  } finally {
    pending.reject(new Error("Connection retired"))
  }
})
