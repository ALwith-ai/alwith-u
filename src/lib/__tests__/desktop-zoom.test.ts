import { beforeEach, expect, test, vi } from "vitest"

import { initializeZoom } from "../desktop-zoom"

const { initialize, get, update } = vi.hoisted(() => ({
  initialize: vi.fn(async () => {}),
  get: vi.fn<() => number | undefined>(),
  update: vi.fn(async (_changes: Record<string, unknown>) => {})
}))
vi.mock("@alwith/module-desktop-shell/zoom", async (original) => ({
  ...(await original<typeof import("@alwith/module-desktop-shell/zoom")>()),
  initializeDesktopZoom: initialize
}))
vi.mock("../settings-store", () => ({ settingsStore: { get }, updateSettings: update }))

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  get.mockReturnValue(undefined)
})

test("migrates the legacy level before shell initialization, then removes the old override", async () => {
  get.mockReturnValue(1.2)
  initialize.mockImplementationOnce(async () => {
    expect(localStorage.getItem("alwith-desktop-shell.zoom")).toBe("1.25")
    expect(update).not.toHaveBeenCalled()
  })
  await initializeZoom()
  expect(update).toHaveBeenCalledWith({ "appearance.zoomLevel": null })
})

test("preserves an existing shell preference instead of restoring a stale legacy value", async () => {
  get.mockReturnValue(0.9)
  localStorage.setItem("alwith-desktop-shell.zoom", "1.5")
  await initializeZoom()
  expect(localStorage.getItem("alwith-desktop-shell.zoom")).toBe("1.5")
  expect(update).toHaveBeenCalledOnce()
})

test("a later startup after resetting to 100% does not resurrect the legacy level", async () => {
  await initializeZoom()
  expect(localStorage.getItem("alwith-desktop-shell.zoom")).toBeNull()
  expect(update).not.toHaveBeenCalled()
  expect(initialize).toHaveBeenCalledOnce()
})

test("failed shell initialization retains the legacy setting for retry", async () => {
  get.mockReturnValue(0.8)
  initialize.mockRejectedValueOnce(new Error("Native zoom failed"))
  await expect(initializeZoom()).rejects.toThrow("Native zoom failed")
  expect(update).not.toHaveBeenCalled()
})

test("a failed preference migration does not clear the legacy setting", async () => {
  get.mockReturnValue(1.5)
  vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
    throw new Error("Storage unavailable")
  })
  await expect(initializeZoom()).rejects.toThrow("Storage unavailable")
  expect(initialize).not.toHaveBeenCalled()
  expect(update).not.toHaveBeenCalled()
  vi.restoreAllMocks()
})
