import { cleanup, fireEvent, render } from "@testing-library/react"
import { useState } from "react"
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

function Harness() {
  const canvas = useMainCanvas("main", true)
  return (
    <div ref={canvas.ref} data-testid="canvas" data-moving={canvas.moving}>
      <div ref={canvas.navigationRef} />
      <button onClick={() => canvas.context.navigate("chat")}>Chat</button>
      <button onClick={() => canvas.context.setDividerDragging(true)}>Start</button>
      <button
        onClick={() =>
          canvas.context.setWorkspace({
            chat: 1000,
            preview: 1000,
            visible: true,
            maximized: false
          })
        }
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

function PagingHarness({ pinned }: { pinned: boolean }) {
  const [screen, setScreen] = useState<"leading" | "main">("leading")
  const canvas = useMainCanvas(screen, pinned, setScreen, true)
  return (
    <div ref={canvas.ref}>
      <div ref={canvas.navigationRef} />
      {[0, 1, 2].map((index) => (
        <button key={index} onClick={() => canvas.select(index)}>
          {index + 1}
        </button>
      ))}
    </div>
  )
}

test.each([false, true])("paging preserves Atlas layout options with pinned=%s", (pinned) => {
  const view = render(<PagingHarness pinned={pinned} />)
  carousel.options.mockClear()
  for (const page of ["2", "3", "1", "2"]) fireEvent.click(view.getByText(page))
  expect(carousel.options.mock.calls.length).toBeGreaterThan(0)
  for (const [options] of carousel.options.mock.calls) {
    expect(options.navigationPinned).toBe(pinned)
  }
})

test("repeated clicks on the selected target leave its animation running", () => {
  const view = render(<PagingHarness pinned={false} />)
  carousel.api.cancelInput.mockClear()
  carousel.api.goToSnap.mockClear()
  fireEvent.click(view.getByText("2"))
  fireEvent.click(view.getByText("2"))
  expect(carousel.api.cancelInput).not.toHaveBeenCalled()
  expect(carousel.api.goToSnap).not.toHaveBeenCalled()
})
