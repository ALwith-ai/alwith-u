import { initializeDesktopZoom, setZoomLevel, zoomLevel } from "@alwith/module-desktop-shell/zoom"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest"

import { ThemeProvider } from "@/components/theme-provider"
import { AppearanceSection } from "@/features/settings/sections/appearance-section"
import { initI18n } from "@/lib/i18n"

import { DesktopZoomFeedback } from "../desktop-zoom-feedback"

const { menu, broadcast, setZoom } = vi.hoisted(() => ({
  menu: new Map<string, () => void>(),
  broadcast: new Map<string, (event: { payload: number }) => void>(),
  setZoom: vi.fn(async (_level: number) => {})
}))
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: vi.fn(async () => {}) }))
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    setZoom,
    listen: async (name: string, callback: () => void) => {
      menu.set(name, callback)
      return () => menu.delete(name)
    }
  })
}))
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(async () => {}),
  listen: async (name: string, callback: (event: { payload: number }) => void) => {
    broadcast.set(name, callback)
    return () => broadcast.delete(name)
  }
}))

beforeAll(async () => {
  await initI18n("zh-CN")
  await initializeDesktopZoom()
})
beforeEach(async () => {
  await setZoomLevel(1)
  vi.clearAllMocks()
})
afterEach(cleanup)

test("U's menu route uses shell state and the shared feedback buttons", async () => {
  render(<DesktopZoomFeedback />)
  await act(async () => menu.get("alwith-shell:zoom-in")?.())
  expect(await screen.findByRole("status")).toHaveTextContent("110%")
  expect(setZoom).toHaveBeenLastCalledWith(1.1)
  fireEvent.click(screen.getByRole("button", { name: "实际大小" }))
  await waitFor(() => expect(zoomLevel()).toBe(1))
  expect(screen.getByRole("status")).toHaveTextContent("100%")
})

test("other windows follow shell broadcasts without opening feedback", async () => {
  render(<DesktopZoomFeedback />)
  await act(async () => broadcast.get("alwith-shell:zoom")?.({ payload: 1.5 }))
  await waitFor(() => expect(setZoom).toHaveBeenLastCalledWith(1.5))
  expect(zoomLevel()).toBe(1.5)
  expect(screen.queryByRole("status")).not.toBeInTheDocument()
})

test("settings keeps feedback silent while shell menu controls remain active", async () => {
  render(<DesktopZoomFeedback showFeedback={false} />)
  await act(async () => menu.get("alwith-shell:zoom-out")?.())
  await waitFor(() => expect(setZoom).toHaveBeenLastCalledWith(0.9))
  expect(zoomLevel()).toBe(0.9)
  expect(screen.queryByRole("status")).not.toBeInTheDocument()
})

test("the appearance setting reads and writes the same shell level as the menu", async () => {
  render(
    <ThemeProvider>
      <AppearanceSection />
      <DesktopZoomFeedback showFeedback={false} />
    </ThemeProvider>
  )
  const select = screen.getByRole("combobox", { name: "界面缩放" })
  fireEvent.click(select)
  const option = await screen.findByRole("option", { name: "125%" })
  fireEvent.pointerDown(option, { pointerType: "mouse" })
  fireEvent.click(option)
  await waitFor(() => expect(setZoom).toHaveBeenLastCalledWith(1.25))
  expect(select).toHaveTextContent("125%")
  await act(async () => menu.get("alwith-shell:actual-size")?.())
  await waitFor(() => expect(select).toHaveTextContent("100%"))
  expect(screen.queryByRole("status")).not.toBeInTheDocument()
})
