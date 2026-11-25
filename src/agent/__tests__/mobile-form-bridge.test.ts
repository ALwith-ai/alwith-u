import { CodexClient } from "@alwith/module-chat/client"
import { createFakeAgent, FakeHubPort } from "@alwith/module-chat/testing"
import { expect, test, vi } from "vitest"

import { observeActionWrite } from "@/features/mobile/reply-confirmation"
import { initializeSessionActions } from "@/features/mobile/session-actions"

const bus = vi.hoisted(() => ({
  events: new Map<string, (event: { payload: unknown }) => void>(),
  invoke: vi.fn<(name: string, payload: Record<string, unknown>) => Promise<void>>().mockResolvedValue(undefined)
}))
vi.mock("@/lib/background-errors", () => ({ reportBackgroundError: vi.fn() }))
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

test("a pending async form reaches a late phone and is answered once through its original ACP request", async () => {
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
      message: "Choose a destination",
      _meta: { codex: { delivery: "async" } },
      requestedSchema: {
        type: "object",
        properties: {
          destination: {
            type: "string",
            oneOf: [
              { const: "Local", title: "Local" },
              { const: "Remote", title: "Remote" }
            ]
          }
        },
        required: ["destination"]
      }
    })
    await vi.waitFor(() => expect(client.state.actions).toHaveLength(1))
    await initializeSessionActions(client)
    emit("get-session-actions", { sessionId, deviceId: "phone", requestId: "get-1" })
    const snapshot = bus.invoke.mock.calls.at(-1)?.[1]
    expect(snapshot).toMatchObject({
      sessionId,
      deviceId: "phone",
      actions: [{ kind: "elicitation", params: { _meta: { codex: { delivery: "async" } } } }]
    })
    bus.invoke.mockRejectedValueOnce(new Error("Snapshot unavailable"))
    emit("get-session-actions", { sessionId, deviceId: "phone", requestId: "failed-read" })
    await vi.waitFor(() =>
      expect(bus.invoke.mock.calls).toContainEqual([
        "plugin:alwith-mobile|bridge_session_actions",
        expect.objectContaining({
          sessionId,
          deviceId: "phone",
          requestId: "failed-read",
          error: "Snapshot unavailable",
          actions: []
        })
      ])
    )
    const [action] = snapshot!.actions as { id: string }[]
    const address = { sessionId, deviceId: "phone", epoch: snapshot!.epoch, actionId: action!.id }
    const answer = { action: "accept", content: { destination: "Remote" } }
    const result = (id: string) =>
      bus.invoke.mock.calls.find(
        ([name, body]) => name.endsWith("|bridge_action_result") && body.clientRequestId === id
      )?.[1]
    emit("action-response", { ...address, sessionId: "other", clientRequestId: "cross", answer })
    await vi.waitFor(() => expect(result("cross")).toMatchObject({ status: "stale" }))
    emit("action-response", { ...address, clientRequestId: "invalid", answer: { action: "accept", content: {} } })
    await vi.waitFor(() => expect(result("invalid")).toMatchObject({ status: "rejected" }))
    const identity = { ...address, clientRequestId: "good" }
    const query = async (
      changes: Record<string, unknown>,
      status: string,
      error: string | null = null
    ): Promise<void> => {
      const target = { ...identity, ...changes }
      const start = bus.invoke.mock.calls.length
      expect(bus.events.has("bridge:action-status")).toBe(true)
      emit("action-status", target)
      await vi.waitFor(() =>
        expect(bus.invoke.mock.calls.slice(start)).toContainEqual([
          "plugin:alwith-mobile|bridge_action_result",
          { ...target, status, error }
        ])
      )
    }
    await query({}, "unknown")
    await query({ clientRequestId: "invalid" }, "rejected", "Invalid answer for this request")
    expect(writes).not.toHaveBeenCalled()
    const request = { ...identity, answer }
    emit("action-response", request)
    emit("action-response", request)
    await query({}, "pending")
    emit("get-session-actions", { sessionId, deviceId: "second-phone", requestId: "get-2" })
    expect(bus.invoke.mock.calls.at(-1)?.[1]).toMatchObject({ actions: [{ id: action!.id }] })
    bus.invoke.mockImplementation(async (name, payload) => {
      if (name.endsWith("|bridge_action_result") && payload.status === "accepted") throw new Error("Phone offline")
    })
    resolve()
    await expect(form).resolves.toEqual(answer)
    await vi.waitFor(() =>
      expect(
        bus.invoke.mock.calls.filter(
          ([name, body]) =>
            name.endsWith("|bridge_action_result") && body.clientRequestId === "good" && body.status === "accepted"
        )
      ).toHaveLength(2)
    )
    bus.invoke.mockResolvedValue(undefined)
    await query({ deviceId: "second-phone" }, "unknown")
    await query({ epoch: "different" }, "unknown")
    await query({ sessionId: "other" }, "unknown")
    await query({ actionId: "other" }, "unknown")
    await query({ clientRequestId: "other" }, "unknown")
    await query({}, "accepted")
    expect(writes).toHaveBeenCalledTimes(1)
    expect(fake.prompts).toHaveLength(0)
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
