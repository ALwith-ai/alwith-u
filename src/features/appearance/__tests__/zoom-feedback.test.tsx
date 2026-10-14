import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { initI18n } from "@/lib/i18n"
import { ThemeProvider } from "@/components/theme-provider"
import { AppearanceSection } from "@/features/settings/sections/appearance-section"
import { hydrateZoom, setZoomLevel, syncZoomLevel, zoomStore } from "@/lib/zoom"
import { ZoomFeedback } from "../zoom-feedback"

const { listeners, stop, setZoom, save } = vi.hoisted(() => ({
  listeners: new Map<string, () => void>(),
  stop: vi.fn(),
  setZoom: vi.fn(async (_level: number) => {}),
  save: vi.fn(async () => {})
}))
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    setZoom,
    listen: async (event: string, callback: () => void) => {
      listeners.set(event, callback)
      return stop
    }
  })
}))
vi.mock("@/lib/preferences", () => ({ savePreference: save }))

await initI18n("en")
beforeEach(async () => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  listeners.clear()
  zoomStore.setState({ level: 1, interaction: 0 })
  await hydrateZoom(null)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function advance(ms: number) {
  act(() => vi.advanceTimersByTime(ms))
}

test("only local operations reveal feedback; every operation restarts the two-second timer", async () => {
  render(<ZoomFeedback />)
  await act(async () => {
    await syncZoomLevel(0.9)
  })
  expect(screen.queryByRole("group")).not.toBeInTheDocument()
  await act(async () => {
    await setZoomLevel(1.1)
  })
  expect(screen.getByRole("status")).toHaveTextContent("110%")
  advance(1500)
  await act(async () => {
    await setZoomLevel(1.25)
  })
  advance(1500)
  expect(screen.getByRole("status")).toHaveTextContent("125%")
  advance(500)
  expect(screen.queryByRole("group")).not.toBeInTheDocument()
})

test("hover pauses dismissal, clicking changes zoom, and leaving starts a fresh timer", async () => {
  render(<ZoomFeedback />)
  await act(async () => {
    await setZoomLevel(0.9)
  })
  const panel = screen.getByRole("group")
  fireEvent.pointerEnter(panel)
  advance(3000)
  const plus = screen.getByRole("button", { name: "Zoom in" })
  await act(async () => {
    fireEvent.pointerDown(plus)
    plus.focus()
    fireEvent.click(plus)
  })
  expect(screen.getByRole("status")).toHaveTextContent("100%")
  expect(screen.getByRole("button", { name: "Reset" })).toBeDisabled()
  fireEvent.pointerLeave(panel)
  advance(1999)
  expect(panel).toBeInTheDocument()
  advance(1)
  expect(panel).not.toBeInTheDocument()
})

test("keyboard focus keeps controls available until focus leaves", async () => {
  render(
    <>
      <ZoomFeedback />
      <button type="button">Outside</button>
    </>
  )
  await act(async () => {
    await setZoomLevel(0.9)
  })
  fireEvent.keyDown(document, { key: "Tab" })
  act(() => screen.getByRole("button", { name: "Zoom in" }).focus())
  advance(3000)
  expect(screen.getByRole("group")).toBeInTheDocument()
  act(() => screen.getByRole("button", { name: "Outside" }).focus())
  advance(2000)
  expect(screen.queryByRole("group")).not.toBeInTheDocument()
})

test("limits disable the corresponding controls and reset restores 100%", async () => {
  render(<ZoomFeedback />)
  await act(async () => {
    await setZoomLevel(0.5)
  })
  expect(screen.getByRole("button", { name: "Zoom out" })).toBeDisabled()
  await act(async () => {
    await setZoomLevel(2)
  })
  expect(screen.getByRole("button", { name: "Zoom in" })).toBeDisabled()
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Reset" }))
  })
  expect(screen.getByRole("status")).toHaveTextContent("100%")
  expect(screen.getByRole("button", { name: "Reset" })).toBeDisabled()
})

test("native menu actions are handled once and listeners are released on unmount", async () => {
  const view = render(<ZoomFeedback />)
  await act(async () => {
    listeners.get("menu:zoom-out")?.()
  })
  expect(screen.getByRole("status")).toHaveTextContent("90%")
  expect(setZoom).toHaveBeenCalledTimes(1)
  view.unmount()
  await act(async () => {})
  expect(stop).toHaveBeenCalledTimes(3)
})

test("Windows Ctrl zoom shortcuts use the same controls", async () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32")
  render(<ZoomFeedback />)
  await act(async () => {
    fireEvent.keyDown(document, { key: "-", ctrlKey: true })
  })
  expect(screen.getByRole("status")).toHaveTextContent("90%")
})

test("settings applies zoom and follows changes without feedback, including menu shortcuts", async () => {
  render(
    <ThemeProvider>
      <AppearanceSection />
      <ZoomFeedback showFeedback={false} />
    </ThemeProvider>
  )
  const select = screen.getByRole("combobox", { name: "Interface zoom" })
  expect(select).toHaveTextContent("100%")
  fireEvent.click(select)
  await act(async () => {
    const option = screen.getByRole("option", { name: "125%" })
    fireEvent.pointerDown(option, { pointerType: "mouse" })
    fireEvent.click(option)
  })
  expect(select).toHaveTextContent("125%")
  expect(screen.queryByRole("group", { name: "Interface zoom" })).not.toBeInTheDocument()
  expect(setZoom).toHaveBeenLastCalledWith(1.25)
  await act(async () => {
    await syncZoomLevel(0.9)
  })
  expect(select).toHaveTextContent("90%")
  await act(async () => {
    listeners.get("menu:zoom-in")?.()
  })
  expect(select).toHaveTextContent("100%")
  expect(screen.queryByRole("group", { name: "Interface zoom" })).not.toBeInTheDocument()
})
