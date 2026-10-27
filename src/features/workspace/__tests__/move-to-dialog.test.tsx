import type { DriveState, RootInfo } from "@alwith/module-drive"
import { createFileTreeController, type FileTreeController } from "@alwith/module-file-tree"
import { createFileSystem, type FileSystem } from "@alwith/module-fs"
import { createMemoryAdapter } from "@alwith/module-fs/testing"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { toast } from "sonner"
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
    reportError: (error) => {
      throw error
    }
  })
  bridge.filesystem.mockReset().mockResolvedValue(fs)
  tree = createFileTreeController({
    fs,
    root: "/drive/One",
    reportError: (error) => {
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
  const last = [...buttons].at(-1)
  if (last === undefined) throw new Error("The dialog has no buttons")
  fireEvent.click(last)
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
  const onMoveTo = vi.fn(() => Promise.resolve(true)),
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
  const onMoveTo = vi.fn(() => Promise.resolve(true)),
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
      onMoveTo={() => Promise.resolve(true)}
      onClose={() => {}}
    />
  )
  fireEvent.click(await screen.findByText("Project Two"))
  expect(document.querySelector(".alwith-directory-warning")?.textContent).toBe(
    "Cloud move preserves history and comments."
  )
})

test("publishing preserves the source and uses the cloud mirror request", async () => {
  bridge.request.mockImplementation((request: { type: string }) => {
    if (request.type === "publishBetweenProjects") return Promise.resolve({ type: "id", data: "mirror-1" })
    return Promise.resolve({ type: "cloudFolders", data: [{ path: "Cloud child", folderId: "cloud-child" }] })
  })
  const onMoveTo = vi.fn(() => Promise.resolve(true))
  const onClose = vi.fn()
  render(
    <MoveToDialog
      mode="publish"
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
  expect(bridge.request).toHaveBeenCalledWith({
    type: "publishBetweenProjects",
    source: "/drive/One/source.txt",
    destination: "/drive/One/Cloud child",
    isDirectory: false
  })
  expect(await fs.stat("/drive/One/source.txt")).not.toBeNull()
  expect(onMoveTo).not.toHaveBeenCalled()
})

for (const kind of ["file", "directory"] as const) {
  test(`publishing a ${kind} keeps local contents and never uses filesystem moves`, async () => {
    bridge.request.mockImplementation((request: { type: string }) =>
      Promise.resolve(
        request.type === "publishBetweenProjects"
          ? { type: "id", data: "mirror-1" }
          : { type: "cloudFolders", data: [] }
      )
    )
    const source = kind === "file" ? "/drive/One/source.txt" : "/drive/One/local"
    const onClose = vi.fn()
    const onMoveTo = vi.fn(() => Promise.resolve(true))
    render(
      <MoveToDialog
        mode="publish"
        sources={[source]}
        rootPath="/drive/One"
        fs={fs}
        tree={tree}
        onMoveTo={onMoveTo}
        onClose={onClose}
      />
    )
    fireEvent.click(await screen.findByText("Project Two"))
    confirm()
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(bridge.request).toHaveBeenCalledWith({
      type: "publishBetweenProjects",
      source,
      destination: "/drive/Two",
      isDirectory: kind === "directory"
    })
    expect(await fs.stat(source)).not.toBeNull()
    expect(onMoveTo).not.toHaveBeenCalled()
  })
}

test("a partial publish reports the completed count and leaves the picker open", async () => {
  let calls = 0
  bridge.request.mockImplementation((request: { type: string }) => {
    if (request.type !== "publishBetweenProjects") return Promise.resolve({ type: "cloudFolders", data: [] })
    if (++calls === 1) return Promise.resolve({ type: "id", data: "mirror-1" })
    return Promise.reject(new Error("Permission denied"))
  })
  const error = vi.spyOn(toast, "error")
  const onClose = vi.fn()
  render(
    <MoveToDialog
      mode="publish"
      sources={["/drive/One/source.txt", "/drive/One/local"]}
      rootPath="/drive/One"
      fs={fs}
      tree={tree}
      onMoveTo={() => Promise.resolve(true)}
      onClose={onClose}
    />
  )
  fireEvent.click(await screen.findByText("Project Two"))
  confirm()
  await waitFor(() =>
    expect(error).toHaveBeenCalledWith("Published 1 items; the remaining items failed: Permission denied")
  )
  expect(onClose).not.toHaveBeenCalled()
  expect(await fs.stat("/drive/One/source.txt")).not.toBeNull()
  error.mockRestore()
})

test("retrying a partial publish sends only pending items to the same destination", async () => {
  const sent: string[] = []
  bridge.request.mockImplementation((request: { type: string; source: string }) => {
    if (request.type !== "publishBetweenProjects") return Promise.resolve({ type: "cloudFolders", data: [] })
    sent.push(request.source)
    if (sent.length === 2) return Promise.reject(new Error("Temporary failure"))
    return Promise.resolve({ type: "id", data: "42" })
  })
  const onClose = vi.fn()
  render(
    <MoveToDialog
      mode="publish"
      sources={["/drive/One/source.txt", "/drive/One/local"]}
      rootPath="/drive/One"
      fs={fs}
      tree={tree}
      onMoveTo={() => Promise.resolve(true)}
      onClose={onClose}
    />
  )
  fireEvent.click(await screen.findByText("Project Two"))
  confirm()
  await screen.findByText(/Published 1 items;.*Temporary failure/)
  confirm()
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  expect(sent).toEqual(["/drive/One/source.txt", "/drive/One/local", "/drive/One/local"])
})

test.each([{ canWrite: false }, { syncEnabled: false }])(
  "publish targets exclude unavailable projects: %j",
  async (permission) => {
    bridge.state!.snapshot!.roots = [root, { ...cloud, ...permission, selected: true }]
    render(
      <MoveToDialog
        mode="publish"
        sources={["/drive/One/source.txt"]}
        rootPath="/drive/One"
        fs={fs}
        tree={tree}
        onMoveTo={() => Promise.resolve(true)}
        onClose={vi.fn()}
      />
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.queryByText("Project Two")).not.toBeInTheDocument()
  }
)

test("a deleted source is rejected even while its tree row is stale", async () => {
  await fs.remove("/drive/One/source.txt")
  bridge.request.mockImplementation((request: { type: string }) =>
    Promise.resolve(
      request.type === "publishBetweenProjects" ? { type: "id", data: "42" } : { type: "cloudFolders", data: [] }
    )
  )
  const onClose = vi.fn()
  render(
    <MoveToDialog
      mode="publish"
      sources={["/drive/One/source.txt"]}
      rootPath="/drive/One"
      fs={fs}
      tree={tree}
      onMoveTo={() => Promise.resolve(true)}
      onClose={onClose}
    />
  )
  fireEvent.click(await screen.findByText("Project Two"))
  confirm()
  await screen.findByText(/source.*(exists|missing|available)/i)
  expect(onClose).not.toHaveBeenCalled()
  expect(
    bridge.request.mock.calls.some(
      ([request]: unknown[]) =>
        typeof request === "object" &&
        request !== null &&
        "type" in request &&
        request.type === "publishBetweenProjects"
    )
  ).toBe(false)
})

test("cloud placeholders are resolved on disk before sending their remote path", async () => {
  await fs.writeFile("/drive/One/cloud.txt.yupcloud", new Uint8Array())
  bridge.request.mockImplementation((request: { type: string }) =>
    Promise.resolve(
      request.type === "publishBetweenProjects" ? { type: "id", data: "42" } : { type: "cloudFolders", data: [] }
    )
  )
  const onClose = vi.fn()
  render(
    <MoveToDialog
      mode="publish"
      sources={["/drive/One/cloud.txt.yupcloud"]}
      rootPath="/drive/One"
      fs={fs}
      tree={tree}
      onMoveTo={() => Promise.resolve(true)}
      onClose={onClose}
    />
  )
  fireEvent.click(await screen.findByText("Project Two"))
  confirm()
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  expect(bridge.request).toHaveBeenCalledWith({
    type: "publishBetweenProjects",
    source: "/drive/One/cloud.txt",
    destination: "/drive/Two",
    isDirectory: false
  })
  expect(await fs.stat("/drive/One/cloud.txt.yupcloud")).not.toBeNull()
})

test("publishing to a different destination does not reuse another destination's successes", async () => {
  const sent: Array<{ source: string; destination: string }> = []
  bridge.request.mockImplementation((request: { type: string; source: string; destination: string }) => {
    if (request.type !== "publishBetweenProjects") return Promise.resolve({ type: "cloudFolders", data: [] })
    sent.push({ source: request.source, destination: request.destination })
    if (sent.length === 2) return Promise.reject(new Error("Temporary failure"))
    return Promise.resolve({ type: "id", data: "42" })
  })
  const onClose = vi.fn()
  render(
    <MoveToDialog
      mode="publish"
      sources={["/drive/One/source.txt", "/drive/One/local"]}
      rootPath="/drive/One"
      fs={fs}
      tree={tree}
      onMoveTo={() => Promise.resolve(true)}
      onClose={onClose}
    />
  )
  fireEvent.click(await screen.findByText("Project Two"))
  confirm()
  await screen.findByText(/Published 1 items;.*Temporary failure/)
  fireEvent.click(screen.getByText("Project One"))
  confirm()
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  expect(sent).toEqual([
    { source: "/drive/One/source.txt", destination: "/drive/Two" },
    { source: "/drive/One/local", destination: "/drive/Two" },
    { source: "/drive/One/source.txt", destination: "/drive/One" },
    { source: "/drive/One/local", destination: "/drive/One" }
  ])
})
