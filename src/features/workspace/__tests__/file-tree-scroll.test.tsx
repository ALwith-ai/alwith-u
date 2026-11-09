import { createFileTreeController, FileTree } from "@alwith/module-file-tree"
import { createFileSystem } from "@alwith/module-fs"
import { createMemoryAdapter } from "@alwith/module-fs/testing"
import { act, cleanup, render } from "@testing-library/react"
import { expect, test, vi } from "vitest"

test("opening a visible file preserves the explorer scroll position", async () => {
  const reportError = vi.fn()
  const fs = createFileSystem({
    adapter: createMemoryAdapter(
      Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`/root/file-${String(i).padStart(2, "0")}.txt`, "text"]))
    ),
    reportError
  })
  const controller = createFileTreeController({ fs, root: "/root", reportError })
  try {
    await controller.refresh()
    const props = {
      controller,
      onOpenFile: vi.fn(),
      onError: reportError,
      requestName: async (): Promise<null> => null,
      confirmDelete: async (): Promise<boolean> => false
    }
    const view = render(<FileTree {...props} />)
    const viewport = view.container.querySelector<HTMLDivElement>(".alwith-tree-rows")!
    Object.defineProperty(viewport, "clientHeight", { value: 714 })
    viewport.scrollTop = 198
    viewport.scrollTo = vi.fn()
    await act(async () => view.rerender(<FileTree {...props} activePath="/root/file-28.txt" />))
    expect(viewport.scrollTop).toBe(198)
    expect(reportError).not.toHaveBeenCalled()
  } finally {
    cleanup()
    controller.dispose()
  }
})
