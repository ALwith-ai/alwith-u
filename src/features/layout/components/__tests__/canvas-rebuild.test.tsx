import { useDesktopCanvas } from "@alwith/module-desktop-shell/react"
import { act, cleanup, fireEvent, render } from "@testing-library/react"
import { useState } from "react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import { initI18n } from "@/lib/i18n"

import { type MainScreen, MainSidebarLayout } from "../main-sidebar-layout"

const carousel = vi.hoisted(() => {
  const api = {
    overview: { getState: () => null, subscribe: vi.fn(() => vi.fn()) },
    refresh: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
    cancelInput: vi.fn(),
    goToSnap: vi.fn(),
    getGeometry: () => ({ selected: 1, snaps: [0, 1] }),
    on: vi.fn<(event: string, listener: () => void) => unknown>(),
    off: vi.fn()
  }
  api.on.mockReturnValue(api)
  api.off.mockReturnValue(api)
  return { api, ref: vi.fn(), options: vi.fn<(options: { navigationPinned?: boolean }) => void>() }
})
vi.mock("@nyssance/atlas/react", () => ({
  useAtlas: (options: { navigationPinned?: boolean }) => {
    carousel.options(options)
    return { ref: carousel.ref, atlas: carousel.api }
  }
}))
vi.mock("@/lib/trackpad-preference", () => ({ useThreeFingerSwipeEnabled: () => false }))
await initI18n("en")

function Controls({ onLeading }: { onLeading?: () => void }) {
  const canvas = useDesktopCanvas()
  if (!canvas) throw new Error("Missing desktop canvas")
  return (
    <>
      <button onClick={onLeading}>1</button>
      <button onClick={() => canvas.navigate("chat")}>2</button>
      <button onClick={() => canvas.navigate("trailing")}>3</button>
      <button onClick={() => canvas.setDividerDragging(true)}>Start</button>
      <button onClick={() => canvas.setWorkspace({ chat: 1000, preview: 1000, visible: true, maximized: false })}>
        Resize
      </button>
      <button onClick={() => canvas.setDividerDragging(false)}>End</button>
    </>
  )
}

function Harness({ pinned = true, initial = "main" }: { pinned?: boolean; initial?: MainScreen }) {
  const [screen, setScreen] = useState<MainScreen>(initial)
  return (
    <MainSidebarLayout
      initialPinned={pinned}
      screen={screen}
      onScreenChange={setScreen}
      sidebar={null}
      leading={null}
      main={<Controls onLeading={() => setScreen("leading")} />}
      trailing={<div />}
    />
  )
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000)
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(256)
  carousel.api.refresh.mockClear()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

test("semantic navigation does not rebuild unchanged canvas geometry", () => {
  const view = render(<Harness />)
  const before = carousel.api.refresh.mock.calls.length
  expect(before).toBeGreaterThan(0)
  fireEvent.click(view.getByText("2"))
  fireEvent.click(view.getByText("2"))
  expect(carousel.api.refresh).toHaveBeenCalledTimes(before)
  expect(view.container.querySelector("[data-canvas-moving]")).toHaveAttribute("data-canvas-moving", "false")
})

test("divider movement rebuilds live and release does not rebuild again", () => {
  const view = render(<Harness />)
  const before = carousel.api.refresh.mock.calls.length
  fireEvent.click(view.getByText("Start"))
  expect(carousel.api.cancelInput).toHaveBeenCalled()
  fireEvent.click(view.getByText("Resize"))
  expect(carousel.api.refresh).toHaveBeenCalledTimes(before + 1)
  fireEvent.click(view.getByText("End"))
  expect(carousel.api.refresh).toHaveBeenCalledTimes(before + 1)
})

test.each([false, true])("offscreen navigation remains eligible for hover with pinned=%s", async (pinned) => {
  const view = render(<Harness pinned={pinned} initial="leading" />)
  const geometry = vi.spyOn(carousel.api, "getGeometry")
  for (const index of [1, 2, 0, 1]) {
    fireEvent.click(view.getByText(String(index + 1)))
    geometry.mockReturnValue({ selected: index, snaps: [0, 1, 2] })
    const listener = carousel.api.on.mock.calls.findLast(([event]) => event === "select")?.[1]
    if (typeof listener !== "function") throw new Error("Missing Atlas selection subscription")
    await act(() => Promise.resolve(listener()))
    const settle = carousel.api.on.mock.calls.findLast(([event]) => event === "settle")?.[1]
    if (!settle) throw new Error("Missing Atlas settle subscription")
    await act(() => Promise.resolve(settle()))
    expect(carousel.options.mock.calls.at(-1)?.[0].navigationPinned).toBe(pinned && index === 1)
  }
})

test("selection during motion defers docking changes until settle", async () => {
  const geometry = vi.spyOn(carousel.api, "getGeometry")
  geometry.mockReturnValue({ selected: 0, snaps: [0, 1, 2] })
  const view = render(<Harness initial="leading" />)
  fireEvent.click(view.getByText("2"))
  geometry.mockReturnValue({ selected: 1, snaps: [0, 1, 2] })
  const select = carousel.api.on.mock.calls.findLast(([event]) => event === "select")?.[1]
  const settle = carousel.api.on.mock.calls.findLast(([event]) => event === "settle")?.[1]
  if (!select || !settle) throw new Error("Missing Atlas subscriptions")
  await act(() => Promise.resolve(select()))
  expect(carousel.options.mock.calls.at(-1)?.[0].navigationPinned).toBe(false)
  await act(() => Promise.resolve(settle()))
  expect(carousel.options.mock.calls.at(-1)?.[0].navigationPinned).toBe(true)
})
