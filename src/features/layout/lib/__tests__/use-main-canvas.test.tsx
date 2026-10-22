import type { EventCallback } from "@tauri-apps/api/event"
import { act, cleanup, render, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import type { TrackpadGesture } from "@/bindings"
import { initI18n } from "@/lib/i18n"

import { useMainCanvas } from "../use-main-canvas"

const native = vi.hoisted(() => ({
  enabled: false,
  available: true,
  listen: vi.fn<(handler: EventCallback<TrackpadGesture>) => Promise<() => void>>(),
  error: vi.fn<(message: string) => void>()
}))
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  isTauri: () => native.available
}))
vi.mock("@/bindings", () => ({ events: { "trackpad-gesture": { listen: native.listen } } }))
vi.mock("@/lib/trackpad-preference", () => ({ useThreeFingerSwipeEnabled: () => native.enabled }))
vi.mock("sonner", () => ({ toast: { error: native.error } }))

await initI18n("en")

/** Embla runs normally; only the asynchronous native subscription is controlled. */
function Canvas(): ReactNode {
  const canvas = useMainCanvas("main", true)
  return (
    <div ref={canvas.ref}>
      <div ref={canvas.navigationRef} />
      <div className="main-screen-track" data-atlas-track>
        <div className="canvas-snap" data-atlas-region="leading" data-atlas-leading />
        <div className="canvas-snap" data-atlas-region="chat" />
      </div>
    </div>
  )
}

beforeEach(() => {
  native.enabled = false
  native.available = true
  native.listen.mockReset()
  native.error.mockReset()
  native.listen.mockResolvedValue(vi.fn<() => void>())
})
afterEach(cleanup)

test("subscribes to the native gesture only after the preference is enabled", async () => {
  const view = render(<Canvas />)
  expect(native.listen).not.toHaveBeenCalled()
  native.enabled = true
  view.rerender(<Canvas />)
  await waitFor(() => expect(native.listen).toHaveBeenCalledTimes(1))
  view.rerender(<Canvas />)
  expect(native.listen).toHaveBeenCalledTimes(1)
})

test("an enabled preference does not subscribe in a browser preview", () => {
  native.available = false
  native.enabled = true
  render(<Canvas />)
  expect(native.listen).not.toHaveBeenCalled()
})

test("unsubscribes once when async setup finishes after unmount", async () => {
  native.enabled = true
  const setup = Promise.withResolvers<() => void>()
  const stop = vi.fn<() => void>()
  native.listen.mockReturnValue(setup.promise)
  const view = render(<Canvas />)
  await waitFor(() => expect(native.listen).toHaveBeenCalledTimes(1))
  view.unmount()
  expect(stop).not.toHaveBeenCalled()
  await act(async () => setup.resolve(stop))
  expect(stop).toHaveBeenCalledTimes(1)
  expect(native.error).not.toHaveBeenCalled()
})

test("reports native subscription setup rejection", async () => {
  native.enabled = true
  native.listen.mockRejectedValue(new Error("Native event subscription denied"))
  render(<Canvas />)
  await waitFor(() => expect(native.error).toHaveBeenCalledExactlyOnceWith("Native event subscription denied"))
})

test("does not report setup rejection after the canvas unmounts", async () => {
  native.enabled = true
  const setup = Promise.withResolvers<() => void>()
  native.listen.mockReturnValue(setup.promise)
  const view = render(<Canvas />)
  await waitFor(() => expect(native.listen).toHaveBeenCalledTimes(1))
  view.unmount()
  await act(async () => setup.reject(new Error("Late setup failure")))
  expect(native.error).not.toHaveBeenCalled()
})

test("disabling the preference disposes the active listener and reenabling installs a new one", async () => {
  native.enabled = true
  const firstStop = vi.fn<() => void>()
  const secondStop = vi.fn<() => void>()
  native.listen.mockResolvedValueOnce(firstStop).mockResolvedValueOnce(secondStop)
  const view = render(<Canvas />)
  await act(async () => {})
  expect(native.listen).toHaveBeenCalledTimes(1)
  native.enabled = false
  view.rerender(<Canvas />)
  expect(firstStop).toHaveBeenCalledTimes(1)
  native.enabled = true
  view.rerender(<Canvas />)
  await waitFor(() => expect(native.listen).toHaveBeenCalledTimes(2))
  view.unmount()
  expect(firstStop).toHaveBeenCalledTimes(1)
  expect(secondStop).toHaveBeenCalledTimes(1)
})

test("disabling during async setup cleans the late listener without installing another", async () => {
  native.enabled = true
  const setup = Promise.withResolvers<() => void>()
  const stop = vi.fn<() => void>()
  native.listen.mockReturnValue(setup.promise)
  const view = render(<Canvas />)
  await waitFor(() => expect(native.listen).toHaveBeenCalledTimes(1))
  native.enabled = false
  view.rerender(<Canvas />)
  await act(async () => setup.resolve(stop))
  expect(stop).toHaveBeenCalledTimes(1)
  expect(native.listen).toHaveBeenCalledTimes(1)
  view.unmount()
  expect(stop).toHaveBeenCalledTimes(1)
})
