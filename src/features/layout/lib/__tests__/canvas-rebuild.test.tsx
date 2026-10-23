import { cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import { initI18n } from "@/lib/i18n"

import { useMainCanvas } from "../use-main-canvas"

const carousel = vi.hoisted(() => {
  const api = {
    refresh: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
    cancelInput: vi.fn(),
    goToSnap: vi.fn(),
    getGeometry: () => ({ selected: 1, snaps: [0, 1] }),
    on: vi.fn(),
    off: vi.fn()
  }
  api.on.mockReturnValue(api)
  api.off.mockReturnValue(api)
  return { api, ref: vi.fn() }
})
vi.mock("@nyssance/atlas/react", () => ({ useAtlas: () => ({ ref: carousel.ref, atlas: carousel.api }) }))
vi.mock("@/lib/trackpad-preference", () => ({ useThreeFingerSwipeEnabled: () => false }))
await initI18n("en")

function Harness() {
  const canvas = useMainCanvas("main", true)
  return (
    <div ref={canvas.ref} data-testid="canvas" data-moving={canvas.moving}>
      <div ref={canvas.navigationRef} />
      <button onClick={() => canvas.context.navigate("chat")}>Chat</button>
      <button onClick={() => canvas.context.setDividerDragging(true)}>Start</button>
      <button
        onClick={() => canvas.context.setWorkspace({ chat: 1000, preview: 1000, visible: true, maximized: false })}
      >
        Resize
      </button>
      <button onClick={() => canvas.context.setDividerDragging(false)}>End</button>
    </div>
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
  fireEvent.click(view.getByText("Chat"))
  fireEvent.click(view.getByText("Chat"))
  expect(carousel.api.refresh).toHaveBeenCalledTimes(before)
  expect(view.getByTestId("canvas")).toHaveAttribute("data-moving", "false")
})

test("divider movement defers rebuilding until release", () => {
  const view = render(<Harness />)
  const before = carousel.api.refresh.mock.calls.length
  fireEvent.click(view.getByText("Start"))
  fireEvent.click(view.getByText("Resize"))
  expect(carousel.api.refresh).toHaveBeenCalledTimes(before)
  fireEvent.click(view.getByText("End"))
  expect(carousel.api.refresh).toHaveBeenCalledTimes(before + 1)
})
