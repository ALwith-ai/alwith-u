import { act, cleanup, render } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import { MainSidebarLayout } from "@/features/layout/components/main-sidebar-layout"
import { initI18n } from "@/lib/i18n"
import { zoomStore } from "@/lib/zoom"

const { native, fullscreen, stop, resized } = vi.hoisted(() => ({
  native: vi.fn(() => true),
  fullscreen: vi.fn(async () => false),
  stop: vi.fn(),
  resized: { callback: () => {} }
}))
vi.mock("@tauri-apps/api/core", async importOriginal => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  isTauri: native
}))
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    isFullscreen: fullscreen,
    onResized: async (callback: () => void) => {
      resized.callback = callback
      return stop
    }
  })
}))

await initI18n("en")
beforeEach(() => {
  vi.clearAllMocks()
  native.mockReturnValue(true)
  fullscreen.mockResolvedValue(false)
  zoomStore.setState({ level: 1, interaction: 0 })
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel")
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

test("macOS chrome moves left in fullscreen on both screens and restores its zoom-compensated inset", async () => {
  const layout = (screen: "main" | "leading") => (
    <MainSidebarLayout initialPinned screen={screen} sidebar={null} leading={null} main={null} />
  )
  const view = render(layout("main"))
  await act(async () => {})
  const root = view.container.querySelector<HTMLElement>("[data-main-screen]")
  expect(root?.style.getPropertyValue("--sidebar-toggle-left")).toBe("calc(80px * var(--window-zoom-correction))")
  fullscreen.mockResolvedValue(true)
  await act(async () => {
    resized.callback()
  })
  expect(root?.style.getPropertyValue("--sidebar-toggle-left")).toBe("8px")
  view.rerender(layout("leading"))
  act(() => zoomStore.setState({ level: 2 }))
  expect(root?.style.getPropertyValue("--sidebar-toggle-left")).toBe("8px")
  fullscreen.mockResolvedValue(false)
  await act(async () => {
    resized.callback()
  })
  expect(root?.style.getPropertyValue("--sidebar-toggle-left")).toBe("calc(80px * var(--window-zoom-correction))")
  view.unmount()
  await act(async () => {})
  expect(stop).toHaveBeenCalledOnce()
})

test("an older fullscreen response cannot overwrite a later transition", async () => {
  let finish: ((value: boolean) => void) | undefined
  fullscreen.mockImplementationOnce(
    () =>
      new Promise<boolean>(resolve => {
        finish = resolve
      })
  )
  const view = render(<MainSidebarLayout initialPinned screen="main" sidebar={null} leading={null} main={null} />)
  await act(async () => {})
  fullscreen.mockResolvedValue(true)
  await act(async () => {
    resized.callback()
  })
  await act(async () => {
    finish?.(false)
  })
  expect(
    view.container.querySelector<HTMLElement>("[data-main-screen]")?.style.getPropertyValue("--sidebar-toggle-left")
  ).toBe("8px")
})

test("browser previews do not call the native window API", async () => {
  native.mockReturnValue(false)
  render(<MainSidebarLayout initialPinned screen="main" sidebar={null} leading={null} main={null} />)
  await act(async () => {})
  expect(fullscreen).not.toHaveBeenCalled()
})
