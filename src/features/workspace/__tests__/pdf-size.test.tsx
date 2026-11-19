import { createEditorController, EditorWorkbench } from "@alwith/module-editor"
import { createFileSystem } from "@alwith/module-fs"
import { createMemoryAdapter } from "@alwith/module-fs/testing"
import { render } from "@testing-library/react"
import { expect, test, vi } from "vitest"

test.each([16 * 1024 * 1024 + 1, 40 * 1024 * 1024 + 1, 4 * 1024 * 1024 * 1024])(
  "a PDF of any size opens by its address without being read: %s bytes",
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
      expect(doc.status).toBe("loaded")
      expect(doc.url).not.toBeNull()
      expect(doc.bytes.byteLength).toBe(0)
      const preview = vi.fn(() => <div>PDF pages</div>)
      const view = render(
        <EditorWorkbench
          controller={editor}
          previews={[{ id: "pdf", supports: () => true, render: preview }]}
          onError={vi.fn()}
        />
      )
      expect(view.getByText("PDF pages")).toBeInTheDocument()
      expect(preview).toHaveBeenCalledWith(expect.objectContaining({ url: doc.url }), expect.anything())
      expect(read).not.toHaveBeenCalled()
    } finally {
      editor.dispose()
    }
  }
)
