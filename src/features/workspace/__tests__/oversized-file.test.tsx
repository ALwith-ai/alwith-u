import { createEditorController, defaultEditorLabels, EditorWorkbench } from "@alwith/module-editor"
import { createFileSystem } from "@alwith/module-fs"
import { createMemoryAdapter } from "@alwith/module-fs/testing"
import { fireEvent, render, waitFor } from "@testing-library/react"
import { expect, test, vi } from "vitest"

test.each(["report.txt", "document.docx", "archive.zip"])(
  "%s past VS Code's large file limit retains a file tab, system actions and an explicit way to open it",
  async (name) => {
    const path = `/repo/${name}`
    const fs = createFileSystem({ adapter: createMemoryAdapter({ [path]: "content" }), reportError: vi.fn() })
    const stat = fs.stat.bind(fs)
    vi.spyOn(fs, "stat").mockImplementation(async (path) => {
      const value = await stat(path)
      return value?.kind === "file" ? { ...value, size: 1024 * 1024 * 1024 + 1 } : value
    })
    const read = vi.spyOn(fs, "readFile")
    const write = vi.spyOn(fs, "writeFile")
    const error = vi.fn()
    const editor = createEditorController({ fs, confirmClose: async () => "cancel", reportError: error })
    const external = vi.fn(async () => {})
    const reveal = vi.fn(async () => {})
    const preview = vi.fn(() => <div>File contents</div>)
    try {
      const doc = await editor.open(path)
      expect(doc).toMatchObject({ path, status: "tooLarge", dirty: false })
      expect(doc.bytes.byteLength).toBe(0)
      const view = render(
        <EditorWorkbench
          controller={editor}
          previews={[{ id: "file", supports: () => true, render: preview }]}
          onOpenExternal={external}
          onReveal={reveal}
          showToolbarActions={false}
          labels={{ ...defaultEditorLabels, openExternal: "Open in system application" }}
          tabLabels={{ reveal: "Show in Finder" }}
          onError={error}
        />
      )
      expect(view.getByRole("tab", { name: new RegExp(name) })).toBeInTheDocument()
      expect(view.getByText("The file is not displayed because it is very large.")).toBeInTheDocument()
      expect(external).not.toHaveBeenCalled()
      expect(reveal).not.toHaveBeenCalled()
      fireEvent.click(view.getByRole("button", { name: "Show in Finder" }))
      fireEvent.click(view.getByRole("button", { name: "Open in system application" }))
      expect(reveal).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: doc.id, path }))
      expect(external).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: doc.id, path }))
      await editor.ensureLoaded(doc.id)
      expect(() => editor.update(doc.id, "must not replace the file")).toThrow("Document content is not loaded")
      expect(editor.getSnapshot().documents[0]?.dirty).toBe(false)
      expect(read).not.toHaveBeenCalled()
      expect(write).not.toHaveBeenCalled()
      expect(preview).not.toHaveBeenCalled()
      expect(error).not.toHaveBeenCalled()
      // Opening it anyway is the user's call, and reads the file.
      fireEvent.click(view.getByRole("button", { name: "Open anyway" }))
      await waitFor(() => expect(editor.getSnapshot().documents[0]?.status).toBe("loaded"))
      expect(read).toHaveBeenCalledOnce()
      expect(await editor.requestClose(doc.id)).toBe(true)
    } finally {
      editor.dispose()
    }
  }
)
