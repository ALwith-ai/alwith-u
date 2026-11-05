import { afterEach, beforeEach, expect, test, vi } from "vitest"

import { zoomStore } from "../zoom"
import { startZoomViewport } from "../zoom-viewport"

const native = vi.hoisted(() => ({ tauri: vi.fn(() => true) }))
vi.mock("@tauri-apps/api/core", () => ({ isTauri: native.tauri }))
vi.mock("../zoom", async () => ({
  zoomStore: (await import("zustand/vanilla")).createStore(() => ({ level: 1, interaction: 0 }))
}))

beforeEach(() => {
  native.tauri.mockReturnValue(true)
  zoomStore.setState({ level: 1, interaction: 0 })
})
afterEach(() => {
  document.documentElement.style.removeProperty("--window-zoom-correction")
  vi.restoreAllMocks()
})
const correction = () => document.documentElement.style.getPropertyValue("--window-zoom-correction")

test("native control sizing follows page zoom without window geometry queries", async () => {
  const stop = await startZoomViewport()
  expect(correction()).toBe("1")
  zoomStore.setState({ level: 1.25 })
  expect(correction()).toBe("0.8")
  zoomStore.setState({ level: 0.5 })
  expect(correction()).toBe("2")
  stop()
})

test("resizing and unrelated zoom state do not invalidate inherited styles", async () => {
  const write = vi.spyOn(document.documentElement.style, "setProperty")
  const stop = await startZoomViewport()
  write.mockClear()
  window.dispatchEvent(new Event("resize"))
  window.dispatchEvent(new Event("resize"))
  zoomStore.setState({ interaction: 1 })
  expect(write).not.toHaveBeenCalled()
  stop()
  zoomStore.setState({ level: 2 })
  expect(correction()).toBe("1")
})

test("browser previews leave native sizing to the stylesheet", async () => {
  native.tauri.mockReturnValue(false)
  const stop = await startZoomViewport()
  expect(correction()).toBe("")
  zoomStore.setState({ level: 2 })
  expect(correction()).toBe("")
  stop()
})
