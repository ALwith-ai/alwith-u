import { createFileTreeController } from "@alwith/module-file-tree/core"
import { createFileSystem, type FileChange } from "@alwith/module-fs"
import { createMemoryAdapter } from "@alwith/module-fs/testing"
import { afterEach, expect, test, vi } from "vitest"

afterEach(() => vi.useRealTimers())

async function fixture() {
  vi.useFakeTimers()
  const adapter = createMemoryAdapter({ "/repo/a/one.txt": "one", "/repo/b/two.txt": "two" })
  const report = vi.fn()
  const fs = createFileSystem({ adapter, reportError: report })
  let notify!: (event: FileChange) => void
  const subscribe = fs.subscribe
  fs.subscribe = (listener) => {
    notify = listener
    return subscribe(listener)
  }
  const tree = createFileTreeController({ fs, root: "/repo", reportError: report })
  await tree.refresh()
  await tree.toggle("/repo/a")
  tree.select("/repo/a/one.txt")
  return {
    adapter,
    tree,
    report,
    async change(paths: string[]) {
      notify({ type: "change", source: "watch", paths })
      await vi.advanceTimersByTimeAsync(100)
    }
  }
}

test("external deletion removes loaded descendants and their selection", async () => {
  const { adapter, tree, change, report } = await fixture()
  try {
    await adapter.remove("/repo/a")
    await change(["/repo/a", "/repo/a/one.txt"])
    expect(tree.getSnapshot().rows.some((row) => row.path.startsWith("/repo/a"))).toBe(false)
    expect(tree.getSnapshot().selected).toEqual([])
    expect(tree.getSnapshot().rows.some((row) => row.path === "/repo/b")).toBe(true)
    expect(report).not.toHaveBeenCalled()
  } finally {
    tree.dispose()
  }
})

test("deleting the displayed root clears stale rows and can recover on a later change", async () => {
  const { adapter, tree, change, report } = await fixture()
  try {
    await adapter.remove("/repo")
    await change(["/repo"])
    expect(tree.getSnapshot().rows).toEqual([])
    expect(tree.getSnapshot().selected).toEqual([])
    expect(tree.getSnapshot().error).not.toBeNull()
    expect(report).toHaveBeenCalledTimes(1)
    await adapter.createDirectory("/repo")
    await adapter.writeFile("/repo/new.txt", new TextEncoder().encode("new"), { mode: "create" })
    await change(["/repo/new.txt"])
    expect(tree.getSnapshot().rows.map((row) => row.path)).toEqual(["/repo", "/repo/new.txt"])
    expect(tree.getSnapshot().error).toBeNull()
  } finally {
    tree.dispose()
  }
})

test("focus refresh failures clear obsolete entries and retain the real error", async () => {
  const { adapter, tree } = await fixture()
  try {
    vi.spyOn(adapter, "readDirectory").mockRejectedValue(new Error("Permission denied"))
    await expect(tree.refresh()).rejects.toThrow("Permission denied")
    expect(tree.getSnapshot()).toMatchObject({ rows: [], selected: [], loading: false, error: "Permission denied" })
  } finally {
    tree.dispose()
  }
})
