import { render } from "@testing-library/react"
import { expect, test, vi } from "vitest"
import { createMonacoEngine } from "@alwith/module-editor/monaco"
import type { EditorController, EditorDocument } from "@alwith/module-editor"
import type * as Monaco from "monaco-editor"

test("line navigation applies on mount and repeat clicks without resetting a restored tab", () => {
  const position = { lineNumber: 2, column: 3 }
  const model = {
    validatePosition: vi.fn(value => value),
    getValue: () => "one\ntwo\nthree",
    onDidChangeContent: () => ({ dispose: vi.fn() }),
    dispose: vi.fn()
  }
  const editor = {
    getModel: () => model,
    setPosition: vi.fn(),
    revealPositionInCenter: vi.fn(),
    saveViewState: () => ({}),
    restoreViewState: vi.fn(),
    addCommand: vi.fn(),
    updateOptions: vi.fn(),
    dispose: vi.fn()
  }
  const monaco = {
    editor: { create: () => editor, createModel: () => model, setTheme: vi.fn() },
    languages: { getLanguages: () => [] },
    Uri: { parse: (value: string) => value },
    KeyMod: { CtrlCmd: 1 },
    KeyCode: { KeyS: 2 }
  } as unknown as typeof Monaco
  const controller = { subscribe: () => vi.fn() } as unknown as EditorController
  const document = { id: "test", path: "/tmp/test.txt", status: "loaded", text: model.getValue() } as EditorDocument
  const engine = createMonacoEngine(monaco, controller)
  const props = { document, onChange: vi.fn(), onSave: vi.fn(), readOnly: false, theme: "dark" as const, position }
  const view = render(<engine.Editor {...props} />)
  expect(editor.setPosition).toHaveBeenLastCalledWith(position)
  expect(editor.revealPositionInCenter).toHaveBeenCalledTimes(1)
  view.unmount()
  const reopened = render(<engine.Editor {...props} />)
  expect(editor.restoreViewState).toHaveBeenCalledTimes(1)
  expect(editor.revealPositionInCenter).toHaveBeenCalledTimes(1)
  reopened.rerender(<engine.Editor {...props} position={{ ...position }} />)
  expect(editor.revealPositionInCenter).toHaveBeenCalledTimes(2)
  reopened.unmount()
  engine.dispose()
})
