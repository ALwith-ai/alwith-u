import { createEditorController, EditorWorkbench } from "@alwith/module-editor"
import { createFileSystem } from "@alwith/module-fs"
import { createMemoryAdapter } from "@alwith/module-fs/testing"
import { fireEvent, render } from "@testing-library/react"
import { expect, test, vi } from "vitest"

test.each([16 * 1024 * 1024 + 1, 40 * 1024 * 1024, 40 * 1024 * 1024 + 1])(
  "PDF preview enforces the 40 MiB boundary: %s bytes",
  async (size) => {
    const fs = createFileSystem({
      adapter: createMemoryAdapter({ "/repo/report.PDF": "%PDF-test" }),
      reportError: vi.fn()
    })
    const original = fs.stat.bind(fs)
    vi.spyOn(fs, "stat").mockImplementation(async (path) => {
      const stat = await original(path)
      return stat?.kind === "file" ? { ...stat, size } : stat
    })
    const read = vi.spyOn(fs, "readFile")
    const editor = createEditorController({ fs, confirmClose: async () => "cancel", reportError: vi.fn() })
    try {
      const doc = await editor.open("/repo/report.PDF")
      const large = size > 40 * 1024 * 1024
      expect(doc.status).toBe(large ? "tooLarge" : "loaded")
      expect(read).toHaveBeenCalledTimes(large ? 0 : 1)
      const external = vi.fn(async () => {})
      const preview = vi.fn(() => <div>PDF pages</div>)
      const view = render(
        <EditorWorkbench
          controller={editor}
          previews={[{ id: "pdf", supports: () => true, render: preview }]}
          onOpenExternal={external}
          onError={vi.fn()}
        />
      )
      expect(external).not.toHaveBeenCalled()
      if (large) {
        expect(view.getByText("This file is too large to preview.")).toBeInTheDocument()
        expect(preview).not.toHaveBeenCalled()
        fireEvent.click(view.getAllByRole("button", { name: "Open externally" }).at(-1)!)
        expect(external).toHaveBeenCalledWith(expect.objectContaining({ path: doc.path }))
        await editor.ensureLoaded(doc.id)
        expect(read).not.toHaveBeenCalled()
      } else expect(view.getByText("PDF pages")).toBeInTheDocument()
    } finally {
      editor.dispose()
    }
  }
)
