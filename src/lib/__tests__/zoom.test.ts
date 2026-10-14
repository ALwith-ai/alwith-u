import { beforeEach, expect, test, vi } from "vitest"
import { hydrateZoom, resetZoom, setZoomLevel, syncZoomLevel, zoomIn, zoomOut, zoomStore } from "../zoom"

const { setZoom, save } = vi.hoisted(() => ({
  setZoom: vi.fn(async (_level: number) => {}),
  save: vi.fn(async (_key: string, _value: number | null) => {})
}))
vi.mock("@tauri-apps/api/webviewWindow", () => ({ getCurrentWebviewWindow: () => ({ setZoom }) }))
vi.mock("@/lib/preferences", () => ({ savePreference: save }))

beforeEach(async () => {
  vi.clearAllMocks()
  zoomStore.setState({ level: 1, interaction: 0 })
  await hydrateZoom(null)
})

test("startup and remote preferences apply without local feedback or another broadcast", async () => {
  await hydrateZoom(0.9)
  expect(zoomStore.getState()).toEqual({ level: 0.9, interaction: 0 })
  await syncZoomLevel(1.25)
  expect(zoomStore.getState()).toEqual({ level: 1.25, interaction: 0 })
  expect(setZoom).toHaveBeenLastCalledWith(1.25)
  expect(save).not.toHaveBeenCalled()
})

test("rapid input advances immediately and serializes native updates and persistence", async () => {
  let finish: (() => void) | undefined
  setZoom.mockImplementationOnce(
    () =>
      new Promise<void>(resolve => {
        finish = resolve
      })
  )
  const first = zoomIn()
  const second = zoomIn()
  const third = zoomOut()
  expect(zoomStore.getState()).toEqual({ level: 1.1, interaction: 3 })
  await Promise.resolve()
  expect(setZoom).toHaveBeenCalledTimes(1)
  expect(save).not.toHaveBeenCalled()
  if (!finish) throw new Error("Native zoom was not requested")
  finish()
  await Promise.all([first, second, third])
  expect(setZoom.mock.calls.map(([level]) => level)).toEqual([1.1, 1.25, 1.1])
  expect(save.mock.calls.map(([, value]) => value)).toEqual([1.1, 1.25, 1.1])
})

test("limits use the existing steps and resetting clears the saved override", async () => {
  await setZoomLevel(9)
  await zoomIn()
  expect(zoomStore.getState().level).toBe(2)
  await setZoomLevel(0.1)
  await zoomOut()
  expect(zoomStore.getState().level).toBe(0.5)
  await resetZoom()
  expect(save).toHaveBeenLastCalledWith("zoomLevel", null)
  expect(() => setZoomLevel(Number.NaN)).toThrow("finite")
})

test("a failed native request restores the applied level and does not poison later changes", async () => {
  setZoom.mockRejectedValueOnce(new Error("Native zoom failed"))
  await expect(zoomIn()).rejects.toThrow("Native zoom failed")
  expect(zoomStore.getState().level).toBe(1)
  expect(save).not.toHaveBeenCalled()
  await zoomOut()
  expect(setZoom).toHaveBeenLastCalledWith(0.9)
  expect(save).toHaveBeenLastCalledWith("zoomLevel", 0.9)
})
