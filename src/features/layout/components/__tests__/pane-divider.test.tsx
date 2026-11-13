import { DesktopWorkspace } from "@alwith/module-desktop-shell/react"
import { act, cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

test("pane dragging coalesces movement and flushes the final position on release", async () => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1200)
  const view = render(
    <DesktopWorkspace
      navigation={null}
      initialNavigationPinned
      panes={[
        { id: "chat", title: "Chat", children: null, min: 420 },
        { id: "preview", title: "Preview", children: null, min: 320, resizable: true }
      ]}
    />
  )
  await act(async () => {})
  const divider = view.container.querySelector<HTMLElement>(".desktop-shell-divider")!
  const preview = view.container.querySelector<HTMLElement>('[data-screen-panel="preview"]')!
  const frames = new Map<number, FrameRequestCallback>()
  let sequence = 0
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.set(++sequence, callback)
    return sequence
  })
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id)
  })
  Object.defineProperty(divider, "setPointerCapture", { value: vi.fn() })
  const initial = preview.style.width
  document.body.style.userSelect = "text"
  fireEvent.pointerDown(divider, { button: 0, clientX: 500, pointerId: 1 })
  for (const clientX of [510, 520, 530]) fireEvent.pointerMove(divider, { clientX, pointerId: 1 })
  expect(preview.style.width).toBe(initial)
  expect(frames.size).toBe(1)
  act(() => {
    for (const callback of [...frames.values()]) callback(16)
  })
  expect(preview.style.width).not.toBe(initial)
  const intermediate = preview.style.width
  fireEvent.pointerMove(divider, { clientX: 560, pointerId: 1 })
  const pendingDragFrame = sequence
  fireEvent.pointerUp(divider, { pointerId: 1 })
  expect(preview.style.width).not.toBe(intermediate)
  expect(frames.has(pendingDragFrame)).toBe(false)
  expect(document.body.style.userSelect).toBe("text")
  fireEvent.pointerDown(divider, { button: 0, clientX: 500, pointerId: 2 })
  fireEvent.pointerMove(divider, { clientX: -1000, pointerId: 2 })
  fireEvent.pointerUp(divider, { pointerId: 2 })
  const chat = view.container.querySelector<HTMLElement>('[data-screen-panel="chat"]')!
  expect(Number.parseFloat(chat.style.width)).toBeGreaterThanOrEqual(420)
  expect(Number.parseFloat(preview.style.width)).toBeGreaterThanOrEqual(320)
  expect(Number.parseFloat(chat.style.width) + Number.parseFloat(preview.style.width)).toBeLessThanOrEqual(952)
  fireEvent.pointerDown(divider, { button: 0, clientX: 500, pointerId: 3 })
  fireEvent.pointerMove(divider, { clientX: 1500, pointerId: 3 })
  fireEvent.pointerUp(divider, { pointerId: 3 })
  expect(Number.parseFloat(chat.style.width)).toBe(952)
  expect(Number.parseFloat(preview.style.width)).toBe(1200)
  document.body.style.userSelect = ""
})
