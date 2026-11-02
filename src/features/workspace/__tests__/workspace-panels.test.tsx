import { type DesktopCanvas, DesktopCanvasContext as CanvasContext } from "@alwith/module-desktop-shell/react"
import { cleanup, render } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

import { initI18n } from "@/lib/i18n"

import { WorkspacePanels } from "../workspace-panels"

await initI18n("en")
afterEach(cleanup)

test("in the main window the shell owns the preview region and its divider", () => {
  const slot = document.createElement("div")
  document.body.append(slot)
  const setPreview = vi.fn()
  const onVisibleChange = vi.fn()
  const canvas: DesktopCanvas = {
    viewportWidth: 1256,
    budget: 1000,
    region: "chat",
    trailingActive: false,
    moving: false,
    previewSlot: slot,
    setPreview,
    navigate: vi.fn()
  }
  try {
    const view = render(
      <CanvasContext.Provider value={canvas}>
        <WorkspacePanels
          visible
          maximized={false}
          onVisibleChange={onVisibleChange}
          onMaximizedChange={vi.fn()}
          chat={<textarea defaultValue="Preserved draft" />}
          preview={<div>Preview</div>}
        />
      </CanvasContext.Provider>
    )
    expect(slot).toHaveTextContent("Preview")
    expect(view.getByRole("textbox")).toHaveValue("Preserved draft")
    expect(view.queryByRole("separator")).not.toBeInTheDocument()
    expect(setPreview).toHaveBeenLastCalledWith({ open: true, maximized: false, onOpenChange: onVisibleChange })
    view.unmount()
  } finally {
    slot.remove()
  }
})

test("a detached window keeps its own chat and preview split", () => {
  const view = render(
    <WorkspacePanels
      visible
      maximized={false}
      onVisibleChange={vi.fn()}
      onMaximizedChange={vi.fn()}
      chat={<textarea defaultValue="Preserved draft" />}
      preview={<div>Preview</div>}
    />
  )
  expect(view.getByText("Preview")).toBeInTheDocument()
  expect(view.getByRole("separator")).toBeInTheDocument()
})
