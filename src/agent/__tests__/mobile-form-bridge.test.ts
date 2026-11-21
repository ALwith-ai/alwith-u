import { CodexClient } from "@alwith/module-chat/client"
import { expect, test, vi } from "vitest"

import { observeActionWrite } from "@/features/mobile/reply-confirmation"
import { initializeSessionActions } from "@/features/mobile/session-actions"

import { createFakeAgent } from "./fake-agent"
import { FakeHubPort } from "./fake-runtime-client"

const bus = vi.hoisted(() => ({
  events: new Map<string, (event: { payload: unknown }) => void>(),
  invoke: vi.fn<(name: string, payload: Record<string, unknown>) => Promise<void>>().mockResolvedValue(undefined)
}))
vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, callback: (event: { payload: unknown }) => void) => {
    bus.events.set(name, callback)
    return Promise.resolve(() => bus.events.delete(name))
  }
}))
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke: bus.invoke
}))

test("a pending form reaches a late phone and is answered once after Runtime delivery", async () => {
  const fake = createFakeAgent()
  const port = new FakeHubPort(() => fake.app)
  const { promise, resolve } = Promise.withResolvers<void>()
  const send = port.acpRespond.bind(port)
  const writes = vi.spyOn(port, "acpRespond").mockImplementation((agent, id, result, error) => {
    const write = promise.then(() => send(agent, id, result, error))
    observeActionWrite(agent, id, error, write)
    return write
  })
  const client = new CodexClient(async () => port, { agentId: "codex", launch: { engine: "codex" } })
  const emit = (name: string, payload: unknown): void => {
    const handler = bus.events.get("bridge:" + name)
    if (!handler) throw new Error("Missing listener " + name)
    handler({ payload })
  }
  try {
    await client.connect()
    const sessionId = await client.newSession("/fixture")
    const form = fake.requestForm({
      sessionId,
      mode: "form",
      message: "Choose a number",
      requestedSchema: {
        type: "object",
        properties: { count: { type: "integer" } },
        required: ["count"]
      }
    })
    await vi.waitFor(() => expect(client.state.actions).toHaveLength(1))
    await initializeSessionActions(client)
    emit("get-session-actions", { sessionId, deviceId: "phone", requestId: "get-1" })
    const snapshot = bus.invoke.mock.calls.at(-1)?.[1]
    expect(snapshot).toMatchObject({ sessionId, deviceId: "phone", actions: [{ kind: "elicitation" }] })
    const [action] = snapshot!.actions as { id: string }[]
    const address = { sessionId, deviceId: "phone", epoch: snapshot!.epoch, actionId: action!.id }
    const answer = { action: "accept", content: { count: 3 } }
    const result = (id: string) =>
      bus.invoke.mock.calls.find(
        ([name, body]) => name.endsWith("|bridge_action_result") && body.clientRequestId === id
      )?.[1]
    emit("action-response", { ...address, sessionId: "other", clientRequestId: "cross", answer })
    await vi.waitFor(() => expect(result("cross")).toMatchObject({ status: "stale" }))
    emit("action-response", { ...address, clientRequestId: "invalid", answer: { action: "accept", content: {} } })
    await vi.waitFor(() => expect(result("invalid")).toMatchObject({ status: "rejected" }))
    const request = { ...address, clientRequestId: "good", answer }
    emit("action-response", request)
    emit("action-response", request)
    expect(result("good")).toBeUndefined()
    emit("get-session-actions", { sessionId, deviceId: "second-phone", requestId: "get-2" })
    expect(bus.invoke.mock.calls.at(-1)?.[1]).toMatchObject({ actions: [{ id: action!.id }] })
    resolve()
    await expect(form).resolves.toEqual(answer)
    await vi.waitFor(() => expect(result("good")).toMatchObject({ status: "accepted" }))
    expect(writes).toHaveBeenCalledTimes(1)
    emit("get-session-actions", { sessionId, deviceId: "phone", requestId: "get-3" })
    expect(bus.invoke.mock.calls.at(-1)?.[1]).toMatchObject({ actions: [] })
  } finally {
    resolve()
    client.disconnect()
  }
})

test("an answer sent outside the chat store retires the phone action even when an RPC id is reused", async () => {
  bus.invoke.mockClear()
  const fake = createFakeAgent()
  const port = new FakeHubPort(() => fake.app)
  const client = new CodexClient(async () => port, { agentId: "codex", launch: { engine: "codex" } })
  const emit = (name: string, payload: unknown): void => {
    const handler = bus.events.get(name)
    if (!handler) throw new Error("Missing listener " + name)
    handler({ payload })
  }
  try {
    await client.connect()
    await initializeSessionActions(client)
    const sessionId = await client.newSession("/fixture")
    const form = fake.requestForm({
      sessionId,
      mode: "form",
      message: "Second source",
      requestedSchema: { type: "object", properties: {} }
    })
    await vi.waitFor(() => expect(client.state.actions).toHaveLength(1))
    const key = client.state.actions[0].id
    emit("mobile:action-opened", { actionId: key })
    const snapshot = (): Record<string, unknown> => {
      emit("bridge:get-session-actions", { deviceId: "phone", sessionId })
      return bus.invoke.mock.calls.at(-1)![1]
    }
    const before = snapshot()
    const wireId = (before.actions as { id: string }[])[0].id
    const writes = vi.spyOn(port, "acpRespond")
    await port.acpRespond("codex", JSON.parse(key), { action: "decline" })
    await expect(form).resolves.toEqual({ action: "decline" })
    expect(client.state.actions).toHaveLength(1)
    emit("mobile:action-resolved", { actionId: key })
    expect(snapshot().actions).toEqual([])
    emit("bridge:action-response", {
      deviceId: "phone",
      sessionId,
      epoch: before.epoch,
      actionId: wireId,
      clientRequestId: "stale-external",
      answer: { action: "decline" }
    })
    await vi.waitFor(() =>
      expect(bus.invoke.mock.calls).toContainEqual([
        "plugin:alwith-mobile|bridge_action_result",
        expect.objectContaining({ clientRequestId: "stale-external", status: "stale" })
      ])
    )
    emit("mobile:action-opened", { actionId: key })
    expect(snapshot().actions).toEqual([])
    expect(writes).toHaveBeenCalledTimes(1)
  } finally {
    client.disconnect()
  }
})
