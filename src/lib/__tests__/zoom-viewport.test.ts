import { afterEach, beforeEach, expect, test, vi } from "vitest"

import { startZoomViewport } from "../zoom-viewport"

const { size, scale, callbacks, unlisten } = vi.hoisted(() => ({
  size: vi.fn(async () => ({ width: 1920 })),
  scale: vi.fn(async () => 2),
  callbacks: { resized: () => {}, scaled: () => {} },
  unlisten: vi.fn()
}))
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }))
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    innerSize: size,
    scaleFactor: scale,
    onResized: async (fn: () => void) => {
      callbacks.resized = fn
      return unlisten
    },
    onScaleChanged: async (fn: () => void) => {
      callbacks.scaled = fn
      return unlisten
    }
  })
}))

beforeEach(() => {
  vi.clearAllMocks()
  size.mockResolvedValue({ width: 1920 })
  scale.mockResolvedValue(2)
})
afterEach(() => document.documentElement.style.removeProperty("--native-viewport-width"))
const width = () => document.documentElement.style.getPropertyValue("--native-viewport-width")
const settle = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

test("uses native logical width and updates it for window and display changes", async () => {
  const stop = await startZoomViewport()
  expect(width()).toBe("960px")
  size.mockResolvedValue({ width: 1600 })
  callbacks.resized()
  await settle()
  expect(width()).toBe("800px")
  size.mockResolvedValue({ width: 800 })
  scale.mockResolvedValue(1)
  callbacks.scaled()
  await settle()
  expect(width()).toBe("800px")
  stop()
  expect(unlisten).toHaveBeenCalledTimes(2)
})

test("late resize responses and disposed listeners cannot overwrite the current width", async () => {
  const stop = await startZoomViewport()
  let finish: ((value: { width: number }) => void) | undefined
  size.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  callbacks.resized()
  size.mockResolvedValue({ width: 1280 })
  callbacks.resized()
  await settle()
  expect(width()).toBe("640px")
  finish?.({ width: 1000 })
  await settle()
  expect(width()).toBe("640px")
  callbacks.resized()
  stop()
  await settle()
  expect(width()).toBe("640px")
})
