import { afterEach, expect, test, vi } from "vitest"

import type { PetRequest } from "../transport"

const bus = vi.hoisted(() => ({
  listeners: new Map<string, Set<(event: { payload: unknown }) => void>>(),
  sent: [] as PetRequest[],
  reply: null as null | ((request: PetRequest) => { value: unknown; error: string | null })
}))
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, callback: (event: { payload: unknown }) => void) => {
    const bucket = bus.listeners.get(name) ?? new Set()
    bucket.add(callback)
    bus.listeners.set(name, bucket)
    return () => bucket.delete(callback)
  },
  emitTo: async (_target: string, name: string, request: PetRequest) => {
    if (name !== "vibemon:request") throw new Error("Unexpected event")
    bus.sent.push(request)
    if (bus.reply) {
      const response = { id: request.id, ...bus.reply(request) }
      for (const callback of bus.listeners.get("vibemon:response") ?? []) callback({ payload: response })
    }
  }
}))
vi.mock("@tauri-apps/api/webviewWindow", () => ({ getCurrentWebviewWindow: () => ({ label: "bubble-menu-vibemon" }) }))
vi.mock("@/features/auth/store", () => ({
  API_BASE_URL: "https://example.test",
  usePlatformAuth: { getState: () => ({ user: { user_uuid: "test-user" } }) }
}))
const { inspectPet, requestPet } = await import("../transport")
const { createPetSessionClient } = await import("../session-client")

afterEach(() => {
  vi.useRealTimers()
  bus.listeners.clear()
  bus.sent.length = 0
  bus.reply = null
})

test("bubble bootstrap recovers when the main listener starts after the first inspect was lost", async () => {
  vi.useFakeTimers()
  const client = createPetSessionClient()
  await vi.advanceTimersByTimeAsync(0)
  expect(bus.sent.map((request) => request.action)).toEqual(["inspect"])
  bus.reply = () => ({ value: null, error: null })
  await vi.advanceTimersByTimeAsync(1000)
  const session = await client
  expect(session.snapshot()).toBeNull()
  expect(bus.sent.map((request) => request.action)).toEqual(["inspect", "inspect"])
  expect(bus.listeners.get("vibemon:response")?.size).toBe(0)
  session.dispose()
  expect(bus.listeners.get("vibemon:observation")?.size).toBe(0)
})

test("an explicit bootstrap failure is not retried and releases observation listeners", async () => {
  bus.reply = () => ({ value: null, error: "Sign in to use Vibemon" })
  await expect(createPetSessionClient()).rejects.toThrow("Sign in to use Vibemon")
  expect(bus.sent).toHaveLength(1)
  expect(bus.listeners.get("vibemon:observation")?.size).toBe(0)
  expect(bus.listeners.get("vibemon:response")?.size).toBe(0)
})

test("bootstrap retries are bounded when the main window remains unavailable", async () => {
  vi.useFakeTimers()
  const failure = expect(inspectPet()).rejects.toThrow("Vibemon request timed out")
  await vi.advanceTimersByTimeAsync(20_000)
  await failure
  expect(bus.sent).toHaveLength(20)
  expect(bus.sent.every((request) => request.action === "inspect")).toBe(true)
  expect(bus.listeners.get("vibemon:response")?.size).toBe(0)
  expect(vi.getTimerCount()).toBe(0)
})

test("message submissions are never retried after a timeout", async () => {
  vi.useFakeTimers()
  const failure = expect(requestPet("send", { text: "Send once" })).rejects.toThrow("Vibemon request timed out")
  await vi.advanceTimersByTimeAsync(20_000)
  await failure
  expect(bus.sent.map((request) => request.action)).toEqual(["send"])
})
