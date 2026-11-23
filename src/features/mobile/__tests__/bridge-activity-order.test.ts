import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { create } from "zustand"

const host = vi.hoisted(() => ({
  publish: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  listen: vi.fn(() => Promise.resolve(() => {}))
}))
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }))
vi.mock("@tauri-apps/api/event", () => ({ listen: host.listen }))
vi.mock("@/bindings", () => ({ commands: { mobileSetActivitySessions: host.publish } }))
vi.mock("@/lib/client", () => ({
  client: { state: { actions: [], connection: "ready", sessions: {} }, store: { subscribe: vi.fn() } }
}))
vi.mock("@/features/sessions/activity-order", () => ({
  useActivityOrder: create(() => ({ ids: ["older", "foreground", "newer"] }))
}))
vi.mock("@/lib/settings-store", () => ({ settingsStore: { get: () => false }, updateSettings: vi.fn() }))
vi.mock("@/lib/background-errors", () => ({ reportBackgroundError: vi.fn() }))
vi.mock("../actions", () => ({ sendMobilePrompt: vi.fn(), respondMobilePermission: vi.fn() }))
import { useActivityOrder } from "@/features/sessions/activity-order"
import { useChatWindowSurface, useMainWindowSurface } from "@/lib/chat-window-state"

import { initializeMobile } from "../bridge"

beforeEach(() => {
  host.publish.mockClear()
  vi.stubEnv("ALWITH_DEV1_MOBILE", undefined)
})
afterEach(() => vi.unstubAllEnvs())

test("registers session actions and keeps the phone's Activity order in sync", async () => {
  useMainWindowSurface.setState({ sessionId: "foreground", visible: true })
  await initializeMobile()
  expect(host.listen).toHaveBeenCalledWith("bridge:get-session-actions", expect.any(Function))
  expect(host.listen).toHaveBeenCalledWith("bridge:action-status", expect.any(Function))
  expect(host.listen).toHaveBeenCalledWith("bridge:action-response", expect.any(Function))
  expect(host.publish).toHaveBeenLastCalledWith({ questionTokens: {}, sessionIds: ["foreground", "older", "newer"] })
  useChatWindowSurface.setState({ sessionId: "newer", visible: true })
  await vi.waitFor(() =>
    expect(host.publish).toHaveBeenLastCalledWith({ questionTokens: {}, sessionIds: ["foreground", "newer", "older"] })
  )
  useMainWindowSurface.setState({ visible: false })
  await vi.waitFor(() =>
    expect(host.publish).toHaveBeenLastCalledWith({ questionTokens: {}, sessionIds: ["newer", "older", "foreground"] })
  )
  useActivityOrder.setState({ ids: ["older", "newer"] })
  await vi.waitFor(() =>
    expect(host.publish).toHaveBeenLastCalledWith({ questionTokens: {}, sessionIds: ["newer", "older"] })
  )
  const count = host.publish.mock.calls.length
  useActivityOrder.setState({ ids: ["older", "newer"] })
  await Promise.resolve()
  expect(host.publish).toHaveBeenCalledTimes(count)
})
