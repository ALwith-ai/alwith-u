import type { DriveState, RootInfo } from "@alwith/module-drive"
import { createFileTreeController, type FileTreeController } from "@alwith/module-file-tree"
import { createFileSystem, type FileSystem } from "@alwith/module-fs"
import { createMemoryAdapter } from "@alwith/module-fs/testing"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import i18n, { initI18n } from "@/lib/i18n"
import { MoveToDialog, pickerRootsOf } from "../move-to-dialog"

const bridge = vi.hoisted(() => ({ state: null as DriveState | null, request: vi.fn(), filesystem: vi.fn() }))
vi.mock("@/features/drive/drive", () => ({
  drive: { getSnapshot: () => bridge.state, subscribe: () => () => {}, request: bridge.request }
}))
vi.mock("@/features/drive/filesystem", () => ({ driveFileSystem: bridge.filesystem }))
const root: RootInfo = {
  projectId: "one",
  projectKey: "one",
  name: "Project One",
  kind: "MATERIAL",
  scope: "PERSONAL",
  deptName: null,
  drivePath: "One",
  node: null,
  container: null,
  nodePath: null,
  skillsPath: null,
  syncEnabled: true,
  canWrite: true,
  cloudOnly: false,
  cursor: null,
  pinned: false,
  departmentId: null,
  ownerId: null,
  isMine: true,
  localPath: "/drive/One",
  selected: true
}
const cloud: RootInfo = {
  ...root,
  projectId: "two",
  projectKey: "two",
  name: "Project Two",
  drivePath: "Two",
  localPath: "/drive/Two",
  selected: false,
  cloudOnly: true
}
let fs: FileSystem
let tree: FileTreeController
beforeEach(async () => {
  await initI18n("en")
  bridge.state = {
    connected: true,
    error: null,
    snapshot: {
      version: 1,
      generation: 1,
      sequence: 0,
      configured: true,
      running: true,
      baseUrl: "https://drive.example",
      localRoot: "/drive",
      webBaseUrl: null,
      status: null,
      roots: [root, cloud],
      files: [],
      projects: [],
      pendingDeletes: [],
      error: null
    }
  }
  bridge.request
    .mockReset()
    .mockResolvedValue({ type: "cloudFolders", data: [{ path: "Cloud child", folderId: "cloud-child" }] })
  fs = createFileSystem({
    adapter: createMemoryAdapter({ "/drive/One/source.txt": "contents", "/drive/One/local/keep.txt": "keep" }),
    reportError: error => {
      throw error
    }
  })
  bridge.filesystem.mockReset().mockResolvedValue(fs)
  tree = createFileTreeController({
    fs,
    root: "/drive/One",
    reportError: error => {
      throw error
    }
  })
  await tree.refresh()
})
afterEach(() => {
  cleanup()
  tree.dispose()
})
function confirm(): void {
  const buttons = document.querySelectorAll<HTMLButtonElement>(".alwith-directory-picker-footer button")
  fireEvent.click(buttons[buttons.length - 1])
}
test("picker roots retain writable unsynced projects, exclude archive/skills, and fall back locally", () => {
  expect(
    pickerRootsOf([cloud, { ...root, kind: "SKILL" }, { ...root, projectKey: "ai-session-archive" }, root], "/local")
  ).toEqual([
    { path: "/drive/One", label: "Project One", synced: true },
    { path: "/drive/Two", label: "Project Two", synced: false }
  ])
  expect(pickerRootsOf([], "/local")).toEqual([{ path: "/local", label: "local", synced: true }])
})
test("same-workspace destination moves through the filesystem controller", async () => {
  const onMoveTo = vi.fn(async () => true),
    onClose = vi.fn()
  render(
    <MoveToDialog
      sources={["/drive/One/source.txt"]}
      rootPath="/drive/One"
      fs={fs}
      tree={tree}
      onMoveTo={onMoveTo}
      onClose={onClose}
    />
  )
  fireEvent.click(await screen.findByText("local"))
  confirm()
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  expect(await fs.stat("/drive/One/source.txt")).toBeNull()
  expect(new TextDecoder().decode(await fs.readFile("/drive/One/local/source.txt"))).toBe("contents")
  expect(onMoveTo).not.toHaveBeenCalled()
})
test("cloud folders absent locally remain selectable and use the host move route", async () => {
  const onMoveTo = vi.fn(async () => true),
    onClose = vi.fn()
  render(
    <MoveToDialog
      sources={["/drive/One/source.txt"]}
      rootPath="/drive/One"
      fs={fs}
      tree={tree}
      onMoveTo={onMoveTo}
      onClose={onClose}
    />
  )
  fireEvent.click(await screen.findByText("Cloud child"))
  confirm()
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  expect(onMoveTo).toHaveBeenCalledWith(["/drive/One/source.txt"], "/drive/One/Cloud child")
  expect(await fs.stat("/drive/One/source.txt")).not.toBeNull()
})

test("unsynced libraries use the cloud-move warning instead of the local cross-project warning", async () => {
  i18n.addResource("en", "translation", "workspace.moveToUnsyncedWarning", "Cloud move preserves history and comments.")
  render(
    <MoveToDialog
      sources={["/drive/One/source.txt"]}
      rootPath="/drive/One"
      fs={fs}
      tree={tree}
      onMoveTo={async () => true}
      onClose={() => {}}
    />
  )
  fireEvent.click(await screen.findByText("Project Two"))
  expect(document.querySelector(".alwith-directory-warning")?.textContent).toBe(
    "Cloud move preserves history and comments."
  )
})
