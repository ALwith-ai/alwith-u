import type { EditorController } from "@alwith/module-editor"
import { preserveFileTabView, releaseFileTabViews } from "@alwith/module-editor/tabs/view-state"
import type { editor } from "monaco-editor"
import { expect, test, vi } from "vitest"

test("a closed file's view survives document replacement while a fresh navigation takes precedence", () => {
  const controller = {} as EditorController
  const view = { cursorState: [{ position: { lineNumber: 12, column: 4 } }], viewState: { scrollTop: 230 } }
  let cursor = (): void => {}
  const instance = {
    getModel: () => ({}),
    saveViewState: () => view,
    restoreViewState: vi.fn(),
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
  expect(instance.restoreViewState).toHaveBeenCalledWith(view)
  reopened()
  vi.mocked(instance.restoreViewState).mockClear()
  const jump = preserveFileTabView(controller, instance, () => "/a.txt", { ...navigation })
  expect(instance.restoreViewState).not.toHaveBeenCalled()
  jump()
  releaseFileTabViews(controller)
  const cleared = preserveFileTabView(controller, instance, () => "/a.txt")
  expect(instance.restoreViewState).not.toHaveBeenCalled()
  cleared()
})
