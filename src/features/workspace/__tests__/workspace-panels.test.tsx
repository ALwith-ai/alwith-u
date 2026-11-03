import { type DesktopCanvas, DesktopCanvasContext as CanvasContext } from "@alwith/module-desktop-shell/react"
import { cleanup, render } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

import { initI18n } from "@/lib/i18n"

import { PreviewPaneContext } from "../preview-pane-context"
import { WorkspacePanels } from "../workspace-panels"

await initI18n("en")
afterEach(cleanup)

test("in the main window the layout's preview pane holds the preview and the shell owns its divider", () => {
  const slot = document.createElement("div")
  document.body.append(slot)
  const show = vi.fn()
  const canvas: DesktopCanvas = {
    viewportWidth: 1256,
    budget: 1000,
    region: "chat",
    trailingActive: false,
    moving: false,
    navigate: vi.fn()
  }
  try {
    const view = render(
      <CanvasContext.Provider value={canvas}>
        <PreviewPaneContext.Provider value={{ slot, show }}>
          <WorkspacePanels
            visible
            maximized={false}
            onMaximizedChange={vi.fn()}
            chat={<textarea defaultValue="Preserved draft" />}
            preview={<div>Preview</div>}
          />
        </PreviewPaneContext.Provider>
      </CanvasContext.Provider>
    )
    expect(slot).toHaveTextContent("Preview")
    expect(view.getByRole("textbox")).toHaveValue("Preserved draft")
    expect(view.queryByRole("separator")).not.toBeInTheDocument()
    expect(show).toHaveBeenLastCalledWith({ hidden: false, maximized: false })
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
      onMaximizedChange={vi.fn()}
      chat={<textarea defaultValue="Preserved draft" />}
      preview={<div>Preview</div>}
    />
  )
  expect(view.getByText("Preview")).toBeInTheDocument()
  expect(view.getByRole("separator")).toBeInTheDocument()
})
