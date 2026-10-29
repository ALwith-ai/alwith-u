import { createFileTreeController, type FileTreeController } from "@alwith/module-file-tree"
import { createFileSystem } from "@alwith/module-fs"
import { createMemoryAdapter } from "@alwith/module-fs/testing"
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import { ExplorerSection } from "@/features/settings/sections/explorer-section"
import { settingsFixture } from "@/lib/__tests__/settings-fixture"
import { initI18n } from "@/lib/i18n"

import { connectExplorerSettings, loadExplorerShowHidden } from "../explorer-settings"

let fixture: ReturnType<typeof settingsFixture>
const trees: FileTreeController[] = []
beforeEach(async () => {
  fixture = settingsFixture()
  await initI18n("en")
})
afterEach(() => {
  cleanup()
  for (const tree of trees.splice(0)) tree.dispose()
  vi.restoreAllMocks()
})

async function project(root: string) {
  const adapter = createMemoryAdapter({ [`${root}/visible.txt`]: "text", [`${root}/.env`]: "secret" })
  const reportError = vi.fn()
  const fs = createFileSystem({ adapter, reportError })
  const tree = await connectExplorerSettings(createFileTreeController({ fs, root, reportError }), reportError)
  trees.push(tree)
  await tree.refresh()
  return tree
}
const showsHiddenFile = (tree: FileTreeController) => tree.getSnapshot().rows.some((row) => row.name === ".env")

test("the settings switch, all open trees, and future projects share one committed preference", async () => {
  const a = await project("/a")
  const b = await project("/b")
  const view = render(<ExplorerSection />)
  const toggle = view.getByRole("switch", { name: "Show hidden files" })
  expect(toggle).not.toBeChecked()
  expect(showsHiddenFile(a)).toBe(false)
  expect(showsHiddenFile(b)).toBe(false)
  fireEvent.click(toggle)
  await waitFor(() => {
    expect(toggle).toBeChecked()
    expect(showsHiddenFile(a)).toBe(true)
    expect(showsHiddenFile(b)).toBe(true)
  })
  expect(showsHiddenFile(await project("/c"))).toBe(true)
  await act(() => a.setShowHidden(false))
  await waitFor(() => {
    expect(toggle).not.toBeChecked()
    expect(showsHiddenFile(b)).toBe(false)
  })
  expect(fixture.values.get("explorer.showHidden")).toBe(false)
})

test("other-window updates synchronize trees and a failed save preserves committed visibility", async () => {
  const tree = await project("/a")
  fixture.changed({ "explorer.showHidden": true })
  await waitFor(() => expect(showsHiddenFile(tree)).toBe(true))
  fixture.write.mockRejectedValueOnce(new Error("Disk full"))
  await expect(tree.setShowHidden(false)).rejects.toThrow("Disk full")
  expect(loadExplorerShowHidden()).toBe(true)
  expect(showsHiddenFile(tree)).toBe(true)
})
