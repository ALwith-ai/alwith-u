import { afterEach, expect, test, vi } from "vitest"

const state = vi.hoisted(() => ({
  exists: false,
  failure: false,
  created: vi.fn(),
  show: vi.fn(),
  focus: vi.fn(),
  unminimize: vi.fn()
}))
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: class {
    static async getByLabel(label: string) {
      expect(label).toBe("guide")
      return state.exists ? { show: state.show, setFocus: state.focus, unminimize: state.unminimize } : null
    }
    constructor(label: string, options: unknown) {
      state.created(label, options)
    }
    async once(event: string, handler: (event: { payload: string }) => void) {
      if (event === "tauri://created" && !state.failure) {
        state.exists = true
        queueMicrotask(() => handler({ payload: "" }))
      }
      if (event === "tauri://error" && state.failure) queueMicrotask(() => handler({ payload: "creation failed" }))
      return () => {}
    }
  }
}))

const { openGuideWindow } = await import("../guide-window")
afterEach(() => {
  state.exists = false
  state.failure = false
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

test("repeated opens create one bundled guide window and restore its focus", async () => {
  await Promise.all([openGuideWindow(), openGuideWindow()])
  expect(state.created).toHaveBeenCalledOnce()
  expect(state.created).toHaveBeenCalledWith(
    "guide",
    expect.objectContaining({ url: "/guide.html", title: "ALwith U Guide" })
  )
  expect(state.show).toHaveBeenCalledTimes(2)
  expect(state.focus).toHaveBeenCalledTimes(2)
  expect(state.unminimize).toHaveBeenCalledTimes(2)
})

test("creation failures reach the caller and a later click can retry", async () => {
  state.failure = true
  await expect(openGuideWindow()).rejects.toThrow("creation failed")
  expect(state.show).not.toHaveBeenCalled()
  state.failure = false
  await openGuideWindow()
  expect(state.created).toHaveBeenCalledTimes(2)
  expect(state.focus).toHaveBeenCalledOnce()
})

test.each(["Win32", "MacIntel"])("%s retains native guide window controls", async platform => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue(platform)
  await openGuideWindow()
  expect(state.created).toHaveBeenCalledWith(
    "guide",
    expect.objectContaining({
      title: "ALwith U Guide",
      hiddenTitle: platform !== "Win32",
      titleBarStyle: platform === "Win32" ? "visible" : "overlay"
    })
  )
  expect(state.created.mock.calls[0]?.[1].decorations).not.toBe(false)
})
