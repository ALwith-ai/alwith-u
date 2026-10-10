import { type CloseDecision, createEditorController } from "@alwith/module-editor"
import { createFileSystem } from "@alwith/module-fs"
import { createMemoryAdapter } from "@alwith/module-fs/testing"
import { afterEach, expect, test, vi } from "vitest"
import { moveWorkspaceFiles, type WorkspaceMoveOwner } from "../move-workspace-files"

const disposals: (() => void)[] = []
function fixture(files: Record<string, string>) {
  const adapter = createMemoryAdapter(files)
  function owner(root: string, decision: CloseDecision = "discard"): WorkspaceMoveOwner {
    const fs = createFileSystem({
      adapter,
      reportError: error => {
        throw error
      }
    })
    const editor = createEditorController({
      fs,
      confirmClose: async () => decision,
      reportError: error => {
        throw error
      }
    })
    disposals.push(() => editor.dispose())
    return { root, fs, editor }
  }
  return { adapter, owner }
}
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose()
  vi.restoreAllMocks()
})

test("native folder move saves dirty text and reopens each destination with its tab state", async () => {
  const f = fixture({ "/source/folder/a.md": "old", "/source/folder/b.md": "B", "/target/.keep": "" })
  const owner = f.owner("/source", "save")
  const a = await owner.editor.open("/source/folder/a.md")
  owner.editor.update(a.id, "saved before move")
  await owner.editor.open("/source/folder/b.md")
  const open = vi.fn(async () => {})
  const invokeMove = vi.fn(async () => {
    expect(owner.editor.getSnapshot().documents).toHaveLength(0)
    expect(new TextDecoder().decode(await f.adapter.readFile(a.path))).toBe("saved before move")
    await f.adapter.move("/source/folder", "/target/folder")
    return { moves: [{ from: "/source/folder", to: "/target/folder" }], cloud: false, error: null }
  })
  expect(await moveWorkspaceFiles(["/source/folder"], "/target", { owners: [owner], invokeMove, open })).toBe(true)
  expect(open.mock.calls).toEqual([
    ["/target/folder/a.md", true, false],
    ["/target/folder/b.md", false, true]
  ])
})

test("cancel across owners restores only already closed tabs and preserves the remaining dirty buffer", async () => {
  const f = fixture({ "/one/a.md": "A", "/two/b.md": "B" })
  const one = f.owner("/one", "save"),
    two = f.owner("/two", "cancel")
  const a = await one.editor.open("/one/a.md"),
    b = await two.editor.open("/two/b.md")
  one.editor.update(a.id, "saved A")
  two.editor.update(b.id, "unsaved B")
  const invokeMove = vi.fn(),
    open = vi.fn()
  expect(await moveWorkspaceFiles([a.path, b.path], "/target", { owners: [one, two], invokeMove, open })).toBe(false)
  expect(invokeMove).not.toHaveBeenCalled()
  expect(open).not.toHaveBeenCalled()
  expect(one.editor.getSnapshot().documents[0]).toMatchObject({
    path: a.path,
    text: "saved A",
    pinned: true,
    dirty: false
  })
  expect(two.editor.getSnapshot().documents[0]).toMatchObject({ id: b.id, text: "unsaved B", dirty: true })
})

test("partial native failure rebases completed mappings and restores untouched sources", async () => {
  const f = fixture({ "/source/a.md": "A", "/source/b.md": "B", "/target/.keep": "" })
  const owner = f.owner("/source")
  const a = await owner.editor.open("/source/a.md"),
    b = await owner.editor.open("/source/b.md")
  const failure = new Error("second move failed")
  const open = vi.fn(async () => {})
  await expect(
    moveWorkspaceFiles([a.path, b.path], "/target", {
      owners: [owner],
      open,
      invokeMove: async () => {
        await f.adapter.move(a.path, "/target/a.md")
        return { moves: [{ from: a.path, to: "/target/a.md" }], cloud: false, error: failure.message }
      }
    })
  ).rejects.toThrow(failure.message)
  expect(open).toHaveBeenCalledWith("/target/a.md", false, false)
  expect(owner.editor.getSnapshot().documents.map(doc => doc.path)).toEqual([b.path])
})

test("successful cloud move leaves source tabs closed without a local destination", async () => {
  const f = fixture({ "/source/a.md": "A" }),
    owner = f.owner("/source")
  await owner.editor.open("/source/a.md")
  const open = vi.fn(async () => {})
  expect(
    await moveWorkspaceFiles(["/source/a.md"], "/cloud", {
      owners: [owner],
      open,
      invokeMove: async () => ({ moves: [{ from: "/source/a.md", to: "/cloud/a.md" }], cloud: true, error: null })
    })
  ).toBe(true)
  expect(owner.editor.getSnapshot().documents).toHaveLength(0)
  expect(open).not.toHaveBeenCalled()
})

test("restoration failures aggregate with the native error and do not prevent other tabs recovering", async () => {
  const f = fixture({ "/source/a.md": "A", "/source/b.md": "B" }),
    owner = f.owner("/source")
  await owner.editor.open("/source/a.md")
  await owner.editor.open("/source/b.md")
  const failure = new Error("native failure"),
    restore = new Error("read failed")
  const original = owner.editor.open
  vi.spyOn(owner.editor, "open").mockImplementation(async path => {
    if (path.endsWith("a.md")) throw restore
    return original(path)
  })
  let caught: unknown
  try {
    await moveWorkspaceFiles(["/source"], "/target", {
      owners: [owner],
      open: vi.fn(),
      invokeMove: async () => {
        throw failure
      }
    })
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(AggregateError)
  expect((caught as AggregateError).errors).toEqual([failure, restore])
  expect(owner.editor.getSnapshot().documents.map(doc => doc.path)).toEqual(["/source/b.md"])
})

test("reopened buffers during a canceled close are never replaced by restoration", async () => {
  const f = fixture({ "/source/a.md": "A", "/source/b.md": "B" }),
    owner = f.owner("/source")
  const a = await owner.editor.open("/source/a.md"),
    b = await owner.editor.open("/source/b.md")
  vi.spyOn(owner.editor, "requestCloseMany").mockImplementation(async () => {
    await owner.editor.requestClose(a.id)
    const reopened = await owner.editor.open(a.path)
    owner.editor.update(reopened.id, "new buffer")
    return false
  })
  const invokeMove = vi.fn()
  expect(await moveWorkspaceFiles(["/source"], "/target", { owners: [owner], invokeMove, open: vi.fn() })).toBe(false)
  expect(invokeMove).not.toHaveBeenCalled()
  expect(owner.editor.getSnapshot().documents.find(doc => doc.path === a.path)?.text).toBe("new buffer")
  expect(owner.editor.getSnapshot().documents.find(doc => doc.id === b.id)?.text).toBe("B")
})

test("cancellation does not reopen tabs independently closed in an owner that was never prompted", async () => {
  const f = fixture({ "/one/a.md": "A", "/two/b.md": "B" })
  const one = f.owner("/one"),
    two = f.owner("/two")
  const a = await one.editor.open("/one/a.md"),
    b = await two.editor.open("/two/b.md")
  vi.spyOn(one.editor, "requestCloseMany").mockImplementation(async () => {
    await one.editor.requestClose(a.id)
    await two.editor.requestClose(b.id)
    return false
  })
  expect(
    await moveWorkspaceFiles([a.path, b.path], "/target", { owners: [one, two], invokeMove: vi.fn(), open: vi.fn() })
  ).toBe(false)
  expect(one.editor.getSnapshot().documents.map(doc => doc.path)).toEqual([a.path])
  expect(two.editor.getSnapshot().documents).toHaveLength(0)
})
