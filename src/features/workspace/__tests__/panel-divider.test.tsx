import { cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"
import { PanelDivider } from "../panel-divider"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  document.body.style.userSelect = ""
})

test("preview grows when dragged left and cancellation restores text selection exactly once", () => {
  const onStart = vi.fn(),
    onDrag = vi.fn(),
    onEnd = vi.fn()
  const view = render(
    <PanelDivider label="Resize" width={600} direction="ltr" onStart={onStart} onDrag={onDrag} onEnd={onEnd} />
  )
  const divider = view.getByRole("separator")
  divider.setPointerCapture = vi.fn()
  document.body.style.userSelect = "text"
  fireEvent.pointerDown(divider, { button: 0, clientX: 600, pointerId: 1 })
  expect(onStart).toHaveBeenCalledOnce()
  expect(document.body.style.userSelect).toBe("none")
  fireEvent.pointerMove(divider, { clientX: 520, pointerId: 1 })
  expect(onDrag).toHaveBeenLastCalledWith(80)
  fireEvent.pointerCancel(divider, { pointerId: 1 })
  fireEvent.lostPointerCapture(divider, { pointerId: 1 })
  expect(onEnd).toHaveBeenCalledOnce()
  expect(document.body.style.userSelect).toBe("text")
})

test("unmounting while dragging restores selection and right-to-left dragging is mirrored", () => {
  const onDrag = vi.fn()
  const view = render(
    <PanelDivider label="Resize" width={600} direction="rtl" onStart={vi.fn()} onDrag={onDrag} onEnd={vi.fn()} />
  )
  const divider = view.getByRole("separator")
  divider.setPointerCapture = vi.fn()
  fireEvent.pointerDown(divider, { button: 0, clientX: 600, pointerId: 1 })
  fireEvent.pointerMove(divider, { clientX: 680, pointerId: 1 })
  expect(onDrag).toHaveBeenLastCalledWith(80)
  view.unmount()
  expect(document.body.style.userSelect).toBe("")
})
