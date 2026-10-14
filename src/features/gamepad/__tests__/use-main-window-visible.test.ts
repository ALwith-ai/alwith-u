import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"
import { useMainWindowVisible } from "../use-main-window-visible"

const native = vi.hoisted(() => ({
  visible: true,
  focus: (): void => {},
  stop: vi.fn(),
  getByLabel: vi.fn()
}))
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: { getByLabel: native.getByLabel },
  getCurrentWebviewWindow: () => ({
    onFocusChanged: async (callback: () => void): Promise<() => void> => {
      native.focus = callback
      return native.stop
    }
  })
}))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

test("refreshes the main-window active state on focus changes and unsubscribes", async () => {
  native.visible = true
  native.getByLabel.mockImplementation(async () => ({ isVisible: async () => native.visible }))
  const onError = vi.fn()
  const { result, unmount } = renderHook(() => useMainWindowVisible(onError))
  await waitFor(() => expect(result.current).toBe(true))
  native.visible = false
  act(() => native.focus())
  await waitFor(() => expect(result.current).toBe(false))
  expect(native.getByLabel).toHaveBeenCalledWith("main")
  unmount()
  await waitFor(() => expect(native.stop).toHaveBeenCalledOnce())
  expect(onError).not.toHaveBeenCalled()
})

test("reports native visibility failures", async () => {
  const error = new Error("Cannot read main window")
  native.getByLabel.mockRejectedValue(error)
  const onError = vi.fn()
  renderHook(() => useMainWindowVisible(onError))
  await waitFor(() => expect(onError).toHaveBeenCalledWith(error))
})
