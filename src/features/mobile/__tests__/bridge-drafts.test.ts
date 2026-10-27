import { expect, test, vi } from "vitest"
const host = vi.hoisted(() => ({
  drafts: { empty: "main" },
  subscriber: null as null | ((state: { draftSessions: Record<string, string> }) => void),
  publish: vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
}))
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }))
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }))
vi.mock("@/bindings", () => ({ commands: { mobileSetDraftSessions: host.publish } }))
vi.mock("@/lib/client", () => ({
  client: {
    state: { draftSessions: host.drafts },
    store: {
      subscribe: (callback: typeof host.subscriber) => {
        host.subscriber = callback
      }
    }
  }
}))
vi.mock("@/lib/settings-store", () => ({ settingsStore: { get: () => false }, updateSettings: vi.fn() }))
vi.mock("@/lib/background-errors", () => ({ reportBackgroundError: vi.fn() }))
vi.mock("../actions", () => ({ sendMobilePrompt: vi.fn(), respondMobilePermission: vi.fn() }))
import { initializeMobile } from "../bridge"

test("publishes draft removal when a history session replaces the empty slot without a Runtime event", async () => {
  await initializeMobile()
  expect(host.publish).toHaveBeenLastCalledWith({ sessionIds: ["empty"] })
  host.subscriber!({ draftSessions: {} })
  await vi.waitFor(() => expect(host.publish).toHaveBeenLastCalledWith({ sessionIds: [] }))
  const count = host.publish.mock.calls.length
  const next = { draftSessions: { replacement: "main" } }
  host.subscriber!(next)
  host.subscriber!(next)
  await vi.waitFor(() => expect(host.publish).toHaveBeenCalledTimes(count + 1))
  expect(host.publish).toHaveBeenLastCalledWith({ sessionIds: ["replacement"] })
})
