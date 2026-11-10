import { createEditorController } from "@alwith/module-editor"
import { createFileTabs } from "@alwith/module-editor/tabs/core"
import { createFileSystem } from "@alwith/module-fs"
import { createMemoryAdapter } from "@alwith/module-fs/testing"
import { expect, test, vi } from "vitest"

function setup(decision: "cancel" | "discard" | "save" = "cancel") {
  const adapter = createMemoryAdapter(
    Object.fromEntries(Array.from({ length: 28 }, (_, index) => [`/repo/${index}.txt`, `${index}`]))
  )
  const reportError = vi.fn()
  const fs = createFileSystem({ adapter, reportError })
  const editor = createEditorController({ fs, reportError, confirmClose: () => Promise.resolve(decision) })
  const tabs = createFileTabs(editor)
  const paths = () => tabs.serialize().tabs.map((tab) => (tab.kind === "new" ? "new" : tab.path))
  return { adapter, fs, editor, tabs, paths, reportError }
}

test("replaces the selected new tab at its dragged position", async () => {
  const { tabs, paths } = setup()
  const first = await tabs.openFile("/repo/0.txt", true)
  const blank = tabs.openNewTab()
  tabs.reorder(blank, first.id)
  tabs.activate(blank)
  const second = await tabs.openFile("/repo/1.txt")
  expect(paths()).toEqual(["/repo/1.txt", "/repo/0.txt"])
  expect(tabs.getSnapshot().activeId).toBe(second.id)
})

test("opening a new tab keeps the old preview and future previews replace the new one", async () => {
  const { tabs, editor, paths } = setup()
  const first = await tabs.openFile("/repo/0.txt")
  tabs.openNewTab()
  const second = await tabs.openFile("/repo/1.txt")
  expect(editor.getSnapshot().documents.find((doc) => doc.id === first.id)?.pinned).toBe(true)
  expect(editor.getSnapshot().documents.find((doc) => doc.id === second.id)?.pinned).toBe(false)
  await tabs.openFile("/repo/2.txt")
  expect(paths()).toEqual(["/repo/0.txt", "/repo/2.txt"])
})

test("an inactive trailing new tab is not consumed by a file opened elsewhere", async () => {
  const { tabs, paths } = setup()
  const first = await tabs.openFile("/repo/0.txt", true)
  tabs.openNewTab()
  tabs.activate(first.id)
  await tabs.openFile("/repo/1.txt", true)
  expect(paths()).toEqual(["/repo/0.txt", "new", "/repo/1.txt"])
})

test("failed file loads preserve both the preview and the selected blank", async () => {
  const { tabs, paths } = setup()
  await tabs.openFile("/repo/0.txt")
  await expect(tabs.openFile("/repo/missing.txt")).rejects.toThrow()
  expect(paths()).toEqual(["/repo/0.txt"])
  const blank = tabs.openNewTab()
  await expect(tabs.openFile("/repo/missing.txt")).rejects.toThrow()
  expect(tabs.getSnapshot().activeId).toBe(blank)
  expect(paths()).toEqual(["/repo/0.txt", "new"])
})

test("a file loading into a blank preserves a later selection and replaces only its original blank", async () => {
  const { adapter, tabs, editor, paths } = setup()
  const first = await tabs.openFile("/repo/0.txt", true)
  tabs.openNewTab()
  const started = Promise.withResolvers<void>()
  const ready = Promise.withResolvers<void>()
  const read = adapter.readFile.bind(adapter)
  vi.spyOn(adapter, "readFile").mockImplementationOnce(async (path) => {
    started.resolve()
    await ready.promise
    return read(path)
  })
  const opening = tabs.openFile("/repo/1.txt")
  await started.promise
  tabs.activate(first.id)
  ready.resolve()
  const file = await opening
  expect(paths()).toEqual(["/repo/0.txt", "/repo/1.txt"])
  expect(tabs.getSnapshot().activeId).toBe(first.id)
  expect(editor.getSnapshot().activeId).toBe(first.id)
  expect(editor.getSnapshot().documents.find((doc) => doc.id === file.id)?.pinned).toBe(true)
})

test("creating a blank while a preview loads keeps the new blank selected", async () => {
  const { adapter, tabs, editor, paths } = setup()
  await tabs.openFile("/repo/0.txt")
  const started = Promise.withResolvers<void>()
  const ready = Promise.withResolvers<void>()
  const read = adapter.readFile.bind(adapter)
  vi.spyOn(adapter, "readFile").mockImplementationOnce(async (path) => {
    started.resolve()
    await ready.promise
    return read(path)
  })
  const opening = tabs.openFile("/repo/1.txt")
  await started.promise
  const blank = tabs.openNewTab()
  ready.resolve()
  await opening
  expect(tabs.getSnapshot().activeId).toBe(blank)
  expect(paths()).toEqual(["/repo/0.txt", "new", "/repo/1.txt"])
  expect(editor.getSnapshot().documents.every((doc) => doc.pinned)).toBe(true)
})

test("edits keep a preview and preview replacement does not enter close history", async () => {
  const { editor, tabs, paths } = setup()
  const first = await tabs.openFile("/repo/0.txt")
  editor.update(first.id, "draft")
  await tabs.openFile("/repo/1.txt")
  await tabs.openFile("/repo/2.txt")
  await tabs.reopenClosed()
  expect(paths()).toEqual(["/repo/0.txt", "/repo/2.txt"])
  expect(editor.getSnapshot().documents[0].text).toBe("draft")
})

test("concurrent reopen requests restore distinct files at their original positions", async () => {
  const { tabs, paths } = setup()
  const first = await tabs.openFile("/repo/0.txt", true)
  const second = await tabs.openFile("/repo/1.txt", true)
  await tabs.openFile("/repo/2.txt", true)
  await tabs.requestClose(second.id)
  await tabs.requestClose(first.id)
  await Promise.all([tabs.reopenClosed(), tabs.reopenClosed()])
  expect(paths()).toEqual(["/repo/0.txt", "/repo/1.txt", "/repo/2.txt"])
})

test("reopening a closed file preserves an unrelated blank tab", async () => {
  const { tabs, paths } = setup()
  const first = await tabs.openFile("/repo/0.txt", true)
  await tabs.requestClose(first.id)
  tabs.openNewTab()
  await tabs.reopenClosed()
  expect(paths()).toEqual(["/repo/0.txt", "new"])
})

test("a slow restore preserves a later selection in both the tabs and editor", async () => {
  const { adapter, tabs, editor } = setup()
  const first = await tabs.openFile("/repo/0.txt", true)
  const second = await tabs.openFile("/repo/1.txt", true)
  await tabs.requestClose(second.id)
  const started = Promise.withResolvers<void>()
  const ready = Promise.withResolvers<void>()
  const read = adapter.readFile.bind(adapter)
  vi.spyOn(adapter, "readFile").mockImplementationOnce(async (path) => {
    started.resolve()
    await ready.promise
    return read(path)
  })
  const reopening = tabs.reopenClosed()
  await started.promise
  tabs.activate(first.id)
  ready.resolve()
  await reopening
  expect(tabs.getSnapshot().activeId).toBe(first.id)
  expect(editor.getSnapshot().activeId).toBe(first.id)
})

test("a failed restore remains retryable", async () => {
  const { tabs, fs, paths } = setup()
  const first = await tabs.openFile("/repo/0.txt", true)
  await tabs.requestClose(first.id)
  await fs.remove("/repo/0.txt")
  await expect(tabs.reopenClosed()).rejects.toThrow()
  await fs.writeFile("/repo/0.txt", new TextEncoder().encode("restored"), { mode: "create" })
  await tabs.reopenClosed()
  expect(paths()).toEqual(["/repo/0.txt"])
})

test("close cancellation preserves dirty content and stops the remaining batch", async () => {
  const { editor, tabs, paths } = setup()
  const first = await tabs.openFile("/repo/0.txt", true)
  const second = await tabs.openFile("/repo/1.txt", true)
  const third = await tabs.openFile("/repo/2.txt", true)
  editor.update(second.id, "draft")
  expect(await tabs.requestCloseMany([first.id, second.id, third.id])).toBe(false)
  expect(paths()).toEqual(["/repo/1.txt", "/repo/2.txt"])
  expect(editor.getSnapshot().documents[0].text).toBe("draft")
})

test("closing an active child returns to its opener and background close keeps selection", async () => {
  const { tabs } = setup()
  const first = await tabs.openFile("/repo/0.txt", true)
  const second = await tabs.openFile("/repo/1.txt", true)
  tabs.activate(first.id)
  const child = await tabs.openFile("/repo/2.txt", true)
  await tabs.requestClose(child.id)
  expect(tabs.getSnapshot().activeId).toBe(first.id)
  await tabs.requestClose(second.id)
  expect(tabs.getSnapshot().activeId).toBe(first.id)
})

test("duplicate close requests share the same guard and create one restore entry", async () => {
  const { tabs, paths } = setup()
  const first = await tabs.openFile("/repo/0.txt", true)
  await Promise.all([tabs.requestClose(first.id), tabs.requestClose(first.id)])
  await tabs.reopenClosed()
  expect(paths()).toEqual(["/repo/0.txt"])
  await tabs.requestClose(tabs.getSnapshot().activeId!)
  await tabs.reopenClosed()
  await tabs.reopenClosed()
  expect(paths()).toEqual(["/repo/0.txt"])
})

test("restores up to 25 recently closed files", async () => {
  const { tabs, paths } = setup()
  for (let index = 0; index < 27; index++) {
    const file = await tabs.openFile(`/repo/${index}.txt`, true)
    await tabs.requestClose(file.id)
  }
  for (let index = 0; index < 27; index++) await tabs.reopenClosed()
  expect(paths()).toHaveLength(25)
  expect(paths()).not.toContain("/repo/0.txt")
  expect(paths()).not.toContain("/repo/1.txt")
})

test("file rename updates persisted routes, and restoring mixed tabs preserves selection", async () => {
  const { editor, tabs, fs } = setup()
  const file = await tabs.openFile("/repo/0.txt", true)
  const blank = tabs.openNewTab()
  tabs.reorder(blank, file.id)
  await fs.move("/repo/0.txt", "/repo/renamed.txt")
  const saved = tabs.serialize()
  tabs.dispose()
  const restored = createFileTabs(editor, saved)
  expect(restored.serialize()).toEqual({
    tabs: [{ kind: "new" }, { kind: "file", path: "/repo/renamed.txt" }],
    activeIndex: 0
  })
})
