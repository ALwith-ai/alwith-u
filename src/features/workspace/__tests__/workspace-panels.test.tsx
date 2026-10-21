import { cleanup, fireEvent, render } from "@testing-library/react"
import { useState } from "react"
import { afterEach, expect, test, vi } from "vitest"

import { CanvasContext } from "@/features/layout/lib/canvas-context"
import { initI18n } from "@/lib/i18n"

import { PreviewSurface } from "../preview-surface"
import { WorkspacePanels } from "../workspace-panels"

await initI18n("en")
afterEach(cleanup)

test("dragging past the minimum keeps preview open on the next screen and reversing restores shared layout", () => {
  const onVisibleChange = vi.fn()
  const setWorkspace = vi.fn()
  const view = render(
    <CanvasContext.Provider
      value={{
        viewportWidth: 1256,
        budget: 1000,
        selected: 1,
        split: false,
        moving: false,
        setWorkspace,
        navigate: vi.fn(),
        setDividerDragging: vi.fn()
      }}
    >
      <WorkspacePanels
        visible
        maximized={false}
        onVisibleChange={onVisibleChange}
        onMaximizedChange={vi.fn()}
        chat={<textarea defaultValue="Retained draft" />}
        preview={<div>Preview</div>}
      />
    </CanvasContext.Provider>
  )
  const divider = view.getByRole("separator")
  divider.setPointerCapture = vi.fn()
  fireEvent.pointerDown(divider, { button: 0, clientX: 500, pointerId: 1 })
  fireEvent.pointerMove(divider, { clientX: 650, pointerId: 1 })
  expect(setWorkspace).toHaveBeenLastCalledWith({ chat: 1000, preview: 1256, visible: true, maximized: false })
  expect(onVisibleChange).not.toHaveBeenCalledWith(false)
  expect(view.getByRole("textbox")).toHaveValue("Retained draft")
  fireEvent.pointerMove(divider, { clientX: 550, pointerId: 1 })
  expect(setWorkspace).toHaveBeenLastCalledWith({ chat: 550, preview: 450, visible: true, maximized: false })
  fireEvent.pointerUp(divider, { pointerId: 1 })
  for (let index = 0; index < 3; index++) fireEvent.keyDown(divider, { key: "ArrowRight" })
  expect(setWorkspace).toHaveBeenLastCalledWith({ chat: 1000, preview: 1256, visible: true, maximized: false })
  fireEvent.keyDown(divider, { key: "ArrowLeft" })
  expect(setWorkspace).toHaveBeenLastCalledWith({ chat: 590, preview: 410, visible: true, maximized: false })
})

test("hiding navigation preserves a manual split until the divider is adjusted again", () => {
  const setWorkspace = vi.fn()
  const renderPanels = (budget: number) => (
    <CanvasContext.Provider
      value={{
        viewportWidth: 1256,
        budget,
        selected: 1,
        split: true,
        moving: false,
        setWorkspace,
        navigate: vi.fn(),
        setDividerDragging: vi.fn()
      }}
    >
      <WorkspacePanels
        visible
        maximized={false}
        onVisibleChange={vi.fn()}
        onMaximizedChange={vi.fn()}
        chat={<div>Chat</div>}
        preview={<div>Preview</div>}
      />
    </CanvasContext.Provider>
  )
  const view = render(renderPanels(1000))
  const divider = view.getByRole("separator")
  for (let index = 0; index < 6; index++) fireEvent.keyDown(divider, { key: "ArrowRight" })
  expect(setWorkspace).toHaveBeenLastCalledWith({ chat: 1000, preview: 1256, visible: true, maximized: false })
  view.rerender(renderPanels(1256))
  expect(setWorkspace).toHaveBeenLastCalledWith({ chat: 1256, preview: 1256, visible: true, maximized: false })
  fireEvent.keyDown(divider, { key: "ArrowLeft" })
  expect(setWorkspace).toHaveBeenLastCalledWith({ chat: 856, preview: 400, visible: true, maximized: false })
})

test("dragging left hides chat and reversing the same pointer gesture restores the draft", () => {
  function Fixture() {
    const [maximized, setMaximized] = useState(false)
    return (
      <CanvasContext.Provider
        value={{
          viewportWidth: 1256,
          budget: 1000,
          selected: 1,
          split: false,
          moving: false,
          setWorkspace: vi.fn(),
          navigate: vi.fn(),
          setDividerDragging: vi.fn()
        }}
      >
        <WorkspacePanels
          visible
          maximized={maximized}
          onVisibleChange={vi.fn()}
          onMaximizedChange={setMaximized}
          chat={<textarea defaultValue="Preserved draft" />}
          preview={<div>Preview</div>}
        />
      </CanvasContext.Provider>
    )
  }
  const view = render(<Fixture />)
  const divider = view.getByRole("separator")
  divider.setPointerCapture = vi.fn()
  fireEvent.pointerDown(divider, { button: 0, clientX: 500, pointerId: 1 })
  fireEvent.pointerMove(divider, { clientX: 250, pointerId: 1 })
  expect(view.queryByRole("textbox")).not.toBeInTheDocument()
  expect(view.container.querySelector(".file-workspace-slide")).toHaveStyle({ width: "0px" })
  expect(view.container.querySelector(".file-workspace-preview-slide")).toHaveStyle({ width: "1000px" })
  fireEvent.pointerMove(divider, { clientX: 500, pointerId: 1 })
  expect(view.getByRole("textbox")).toHaveValue("Preserved draft")
  expect(view.container.querySelector(".file-workspace-slide")).toHaveStyle({ width: "500px" })
  fireEvent.pointerUp(divider, { pointerId: 1 })
})

test.each([-250, 150])("preview restore after dragging %ipx resets the actual layout", (delta) => {
  const setWorkspace = vi.fn()
  const navigate = vi.fn()
  function Fixture() {
    const [maximized, setMaximized] = useState(false)
    return (
      <CanvasContext.Provider
        value={{
          viewportWidth: 1256,
          budget: 1000,
          selected: 1,
          split: false,
          moving: false,
          setWorkspace,
          navigate,
          setDividerDragging: vi.fn()
        }}
      >
        <WorkspacePanels
          visible
          maximized={maximized}
          onVisibleChange={vi.fn()}
          onMaximizedChange={setMaximized}
          chat={<textarea defaultValue="Preserved draft" />}
          preview={
            <PreviewSurface
              tree={null}
              treeVisible={false}
              onTreeVisibleChange={vi.fn()}
              maximized={maximized}
              onMaximize={() => setMaximized((value) => !value)}
              onClose={vi.fn()}
              editor={({ trailing }) => (
                <div>
                  {trailing}
                  <input aria-label="Editor" defaultValue="Preserved edit" />
                </div>
              )}
            />
          }
        />
      </CanvasContext.Provider>
    )
  }
  const view = render(<Fixture />)
  const divider = view.getByRole("separator")
  divider.setPointerCapture = vi.fn()
  fireEvent.pointerDown(divider, { button: 0, clientX: 500, pointerId: 1 })
  fireEvent.pointerMove(divider, { clientX: 500 + delta, pointerId: 1 })
  // Real pointer streams continue after crossing the threshold.
  fireEvent.pointerMove(divider, { clientX: 500 + delta + Math.sign(delta), pointerId: 1 })
  fireEvent.pointerUp(divider, { pointerId: 1 })
  expect(view.getByRole("button", { name: "Restore" })).toHaveAttribute("aria-pressed", "true")
  fireEvent.click(view.getByRole("button", { name: "Restore" }))
  expect(setWorkspace).toHaveBeenLastCalledWith({ chat: 500, preview: 500, visible: true, maximized: false })
  expect(view.getByRole("button", { name: "Maximize" })).toHaveAttribute("aria-pressed", "false")
  expect(view.getByRole("textbox", { name: "" })).toHaveValue("Preserved draft")
  expect(view.getByRole("textbox", { name: "Editor" })).toHaveValue("Preserved edit")
  expect(navigate).toHaveBeenLastCalledWith("chat")
})
