import type { EditorController } from "@alwith/module-editor"
import { preserveFileTabView, releaseFileTabViews } from "@alwith/module-editor/tabs/view-state"
import type { editor } from "monaco-editor"
import { expect, test, vi } from "vitest"

test("a closed file's view survives document replacement while a fresh navigation takes precedence", () => {
  const controller = {} as EditorController
  const view = { cursorState: [{ position: { lineNumber: 12, column: 4 } }], viewState: { scrollTop: 230 } }
  let cursor = (): void => {}
  const restoreViewState = vi.fn()
  const instance = {
    getModel: () => ({}),
    saveViewState: () => view,
    restoreViewState,
    onDidChangeCursorPosition: (listener: () => void) => {
      cursor = listener
      return { dispose: vi.fn() }
    },
    onDidScrollChange: () => ({ dispose: vi.fn() })
  } as unknown as editor.IStandaloneCodeEditor
  const navigation = { lineNumber: 2, column: 1 }
  const first = preserveFileTabView(controller, instance, () => "/a.txt", navigation)
  cursor()
  first()
  const reopened = preserveFileTabView(controller, instance, () => "/a.txt", navigation)
  expect(restoreViewState).toHaveBeenCalledWith(view)
  reopened()
  restoreViewState.mockClear()
  const jump = preserveFileTabView(controller, instance, () => "/a.txt", { ...navigation })
  expect(restoreViewState).not.toHaveBeenCalled()
  jump()
  releaseFileTabViews(controller)
  const cleared = preserveFileTabView(controller, instance, () => "/a.txt")
  expect(restoreViewState).not.toHaveBeenCalled()
  cleared()
})
