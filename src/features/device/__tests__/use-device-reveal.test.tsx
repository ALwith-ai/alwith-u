import { act, renderHook } from "@testing-library/react"
import { expect, test, vi } from "vitest"

import { useDeviceReveal } from "../use-device-reveal"

const subscriptions = vi.hoisted(() => new Map<string, (entries: { udid: string; attachedAt: string }[]) => void>())
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }))
vi.mock("@alwith/module-device/tauri", () => ({
  deviceBridge: (sessionId: string) => ({
    subscribe: (callback: (entries: unknown[]) => void) => {
      subscriptions.set(sessionId, callback)
      return () => {}
    }
  })
}))

test("new attachments reveal once; stale background updates cannot open the selected conversation's pane", () => {
  const reveal = vi.fn()
  const { rerender, unmount } = renderHook(({ id }) => useDeviceReveal(id, reveal), { initialProps: { id: "a" } })
  const first = subscriptions.get("a")!
  act(() => first([{ udid: "one", attachedAt: "time-1" }]))
  expect(reveal).toHaveBeenCalledTimes(1)
  act(() => first([{ udid: "one", attachedAt: "time-1" }]))
  expect(reveal).toHaveBeenCalledTimes(1)
  rerender({ id: "b" })
  act(() => first([{ udid: "two", attachedAt: "time-2" }]))
  expect(reveal).toHaveBeenCalledTimes(1)
  act(() => subscriptions.get("b")!([{ udid: "three", attachedAt: "time-3" }]))
  expect(reveal).toHaveBeenCalledTimes(2)
  rerender({ id: "a" })
  act(() => subscriptions.get("a")!([{ udid: "one", attachedAt: "time-1" }]))
  expect(reveal).toHaveBeenCalledTimes(2)
  unmount()
})
