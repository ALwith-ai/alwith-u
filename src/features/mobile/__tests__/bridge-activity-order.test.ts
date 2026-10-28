import { beforeEach, expect, test, vi } from "vitest"
import { create } from "zustand"

const host = vi.hoisted(() => ({ publish: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) }))
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }))
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }))
vi.mock("@/bindings", () => ({ commands: { mobileSetActivitySessions: host.publish } }))
vi.mock("@/lib/client", () => ({ client: {} }))
vi.mock("@/features/sessions/activity-order", () => ({
  useActivityOrder: create(() => ({ ids: ["older", "foreground", "newer"] }))
}))
vi.mock("@/lib/settings-store", () => ({ settingsStore: { get: () => false }, updateSettings: vi.fn() }))
vi.mock("@/lib/background-errors", () => ({ reportBackgroundError: vi.fn() }))
vi.mock("../actions", () => ({ sendMobilePrompt: vi.fn(), respondMobilePermission: vi.fn() }))
import { useActivityOrder } from "@/features/sessions/activity-order"
import { useChatWindowSurface, useMainWindowSurface } from "@/lib/chat-window-state"

import { initializeMobile } from "../bridge"

beforeEach(() => host.publish.mockClear())

test("publishes the Activity panel's order, including surface changes and removed drafts", async () => {
  useMainWindowSurface.setState({ sessionId: "foreground", visible: true })
  await initializeMobile()
  expect(host.publish).toHaveBeenLastCalledWith({ sessionIds: ["foreground", "older", "newer"] })
  useChatWindowSurface.setState({ sessionId: "newer", visible: true })
  await vi.waitFor(() =>
    expect(host.publish).toHaveBeenLastCalledWith({ sessionIds: ["foreground", "newer", "older"] })
  )
  useMainWindowSurface.setState({ visible: false })
  await vi.waitFor(() =>
    expect(host.publish).toHaveBeenLastCalledWith({ sessionIds: ["newer", "older", "foreground"] })
  )
  useActivityOrder.setState({ ids: ["older", "newer"] })
  await vi.waitFor(() => expect(host.publish).toHaveBeenLastCalledWith({ sessionIds: ["newer", "older"] }))
  const count = host.publish.mock.calls.length
  useActivityOrder.setState({ ids: ["older", "newer"] })
  await Promise.resolve()
  expect(host.publish).toHaveBeenCalledTimes(count)
})
