import { afterEach, expect, test, vi } from "vitest"

const transport = vi.hoisted(() => ({
  label: "settings",
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
  emit: vi.fn<(target: string, name: string, payload: { requestId: string }) => Promise<void>>()
}))
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: transport.label }) }))
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((name: string, listener: (event: { payload: unknown }) => void) => {
    return Promise.try(() => {
      transport.listeners.set(name, listener)
      return () => transport.listeners.delete(name)
    })
  }),
  emitTo: transport.emit
}))

import { requestMainReload, serveMainReload } from "../reload-window"

afterEach(() => {
  transport.listeners.clear()
  vi.clearAllMocks()
  vi.useRealTimers()
})

test("settings request resolves only after the main window returns its outcome", async () => {
  transport.label = "settings"
  transport.emit.mockImplementation((_target, _name, payload) => {
    return Promise.try(() => {
      transport.listeners.get("extension:reload-result")?.({ payload: { requestId: "unrelated", outcome: "updated" } })
      transport.listeners.get("extension:reload-result")?.({
        payload: { requestId: payload.requestId, outcome: "updated" }
      })
    })
  })
  expect(await requestMainReload("notes")).toBe("updated")
  expect(transport.emit).toHaveBeenCalledWith(
    "main",
    "extension:reload-request",
    expect.objectContaining({ id: "notes", replyTo: "settings" })
  )
  expect(transport.listeners.size).toBe(0)
})

test("main initialization failure is reported instead of success", async () => {
  transport.label = "main"
  const action = vi.fn().mockRejectedValue(new Error("Main activation failed"))
  await serveMainReload(action)
  transport.listeners.get("extension:reload-request")?.({
    payload: { id: "notes", requestId: "request", replyTo: "settings" }
  })
  await vi.waitFor(() =>
    expect(transport.emit).toHaveBeenCalledWith("settings", "extension:reload-result", {
      requestId: "request",
      error: "Main activation failed"
    })
  )
  expect(action).toHaveBeenCalledWith("notes")
})

test("a missing main reply times out and releases the listener", async () => {
  vi.useFakeTimers()
  transport.label = "settings"
  transport.emit.mockResolvedValue(undefined)
  const pending = requestMainReload("notes")
  const assertion = expect(pending).rejects.toThrow("timed out")
  await vi.advanceTimersByTimeAsync(180_000)
  await assertion
  expect(transport.listeners.size).toBe(0)
})
