import type { EventCallback } from "@tauri-apps/api/event"
import { act, renderHook, waitFor } from "@testing-library/react"
import { expect, test, vi } from "vitest"

const bus = vi.hoisted(() => ({
  handlers: new Map<string, EventCallback<unknown>>(),
  emit: vi.fn().mockResolvedValue(undefined)
}))
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, handler: EventCallback<unknown>) => {
    bus.handlers.set(name, handler)
    return () => {
      if (bus.handlers.get(name) === handler) bus.handlers.delete(name)
    }
  }),
  emitTo: bus.emit
}))
import { useSettingsAccount } from "../settings-bridge"

test("tab remount keeps the last account during refresh and refresh failure; sign-out replaces it", async () => {
  const first = renderHook(useSettingsAccount)
  await waitFor(() => expect(bus.emit).toHaveBeenCalledWith("main", "settings:request-account"))
  const account = { account: { account: { type: "apiKey" }, requiresOpenaiAuth: true }, rateLimits: null }
  act(() => bus.handlers.get("settings:account")?.({ event: "settings:account", id: 0, payload: account }))
  expect(first.result.current).toEqual(account)
  first.unmount()
  bus.emit.mockClear()
  const next = renderHook(useSettingsAccount)
  expect(next.result.current).toEqual(account)
  await waitFor(() => expect(bus.emit).toHaveBeenCalledOnce())
  const log = vi.spyOn(console, "error").mockImplementation(() => {})
  try {
    act(() =>
      bus.handlers.get("settings:account-error")?.({ event: "settings:account-error", id: 0, payload: "Offline" })
    )
    expect(next.result.current).toEqual(account)
    const signedOut = { account: { account: null, requiresOpenaiAuth: true }, rateLimits: null }
    act(() => bus.handlers.get("settings:account")?.({ event: "settings:account", id: 0, payload: signedOut }))
    expect(next.result.current).toEqual(signedOut)
  } finally {
    next.unmount()
    log.mockRestore()
  }
})
