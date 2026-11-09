import { createFileTreeController, FileTree, type FileTreeController } from "@alwith/module-file-tree"
import { createFileSystem } from "@alwith/module-fs"
import { createMemoryAdapter } from "@alwith/module-fs/testing"
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

const scrollToIndex = vi.hoisted(() => vi.fn())
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, start: index * 22 })),
    getTotalSize: () => count * 22,
    scrollToIndex
  })
}))

let tree: FileTreeController
const onError = vi.fn()
beforeEach(async () => {
  scrollToIndex.mockClear()
  onError.mockClear()
  const fs = createFileSystem({
    adapter: createMemoryAdapter(
      Object.fromEntries(Array.from({ length: 60 }, (_, index) => [`/project/file-${index}.txt`, "text"]))
    ),
    reportError: onError
  })
  tree = createFileTreeController({ fs, root: "/project", reportError: onError })
  await tree.refresh()
})
afterEach(() => {
  cleanup()
  tree.dispose()
  vi.restoreAllMocks()
})

function explorer(activePath: string | null, onOpenFile = vi.fn()) {
  return (
    <FileTree
      controller={tree}
      activePath={activePath}
      onOpenFile={onOpenFile}
      requestName={async () => null}
      confirmDelete={async () => false}
      onError={onError}
      renderIcon={() => null}
    />
  )
}

test("opening a clicked file preserves the tree viewport and does not reveal it again", async () => {
  const reveal = vi.spyOn(tree, "reveal")
  const open = vi.fn()
  const view = render(explorer(null, open))
  const viewport = view.getByRole("tree")
  viewport.scrollTop = 440
  fireEvent.click(view.getByText("file-25.txt"))
  expect(open).toHaveBeenCalledWith("/project/file-25.txt")
  await act(async () => view.rerender(explorer("/project/file-25.txt", open)))
  expect(viewport.scrollTop).toBe(440)
  expect(reveal).not.toHaveBeenCalled()
  expect(scrollToIndex).not.toHaveBeenCalled()
  expect(onError).not.toHaveBeenCalled()
})

test("switching files from the editor uses nearest scrolling without a preliminary jump", async () => {
  const view = render(explorer(null))
  const viewport = view.getByRole("tree")
  viewport.scrollTop = 440
  view.rerender(explorer("/project/file-50.txt"))
  const index = tree.getSnapshot().rows.findIndex((row) => row.path === "/project/file-50.txt")
  await waitFor(() => expect(scrollToIndex).toHaveBeenCalledWith(index, { align: "auto" }))
  expect(viewport.scrollTop).toBe(440)
  expect(tree.getSnapshot().selected).toEqual(["/project/file-50.txt"])
  expect(onError).not.toHaveBeenCalled()
})
