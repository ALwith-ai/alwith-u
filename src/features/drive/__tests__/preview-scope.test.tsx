import {
  CONTRACT_VERSION,
  type DriveRequest,
  type DriveResponse,
  type RootInfo,
  type Snapshot
} from "@alwith/module-drive"
import type { DriveContentHost } from "@alwith/module-drive/content"
import { createEditorController, type PreviewContext } from "@alwith/module-editor"
import { createFileSystem } from "@alwith/module-fs"
import { createMemoryAdapter } from "@alwith/module-fs/testing"
import { act, cleanup, render, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

const bridge = vi.hoisted(() => ({ request: vi.fn<(request: DriveRequest) => Promise<DriveResponse>>() }))
vi.mock("../controller", async () => {
  const { createDriveController } = await import("@alwith/module-drive")
  const transport = { request: bridge.request, subscribe: async () => () => {} }
  return { drive: createDriveController(transport), driveTransport: transport }
})

import { drive } from "../controller"
import { scopedDrivePreviewProviders } from "../preview-providers"

const root: RootInfo = {
  projectId: "one",
  projectKey: "one",
  name: "One",
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
let snapshot: Snapshot
const onError = vi.fn()
const host: DriveContentHost = {
  transport: { request: bridge.request, subscribe: async () => () => {} },
  userName: "Test",
  pushConnected: false,
  language: "en",
  translate: (key) => key,
  onError,
  saveDocument: async () => {},
  collaborationOwner: () => {},
  notify: { error: vi.fn(), success: vi.fn() },
  searchUsers: async () => [],
  controls: {
    Button: (props) => <button {...props} />,
    Input: (props) => <input {...props} />,
    Textarea: (props) => <textarea {...props} />,
    Checkbox: () => null
  }
}
const context: PreviewContext = { readOnly: false, onChange: vi.fn(), onSave: vi.fn(), onError }

beforeEach(async () => {
  snapshot = {
    version: CONTRACT_VERSION,
    generation: 1,
    sequence: 0,
    configured: true,
    running: false,
    baseUrl: "https://drive.test",
    localRoot: "/drive",
    webBaseUrl: null,
    status: null,
    roots: [root],
    files: [],
    projects: [],
    pendingDeletes: [],
    error: "Startup failed"
  }
  bridge.request.mockImplementation(async (request) => {
    if (request.type === "snapshot") return { type: "snapshot", data: snapshot }
    if (request.type === "collabSession") {
      if (!snapshot.running) throw new Error("Drive is not running")
      return { type: "collabSession", data: null }
    }
    throw new Error(`Unexpected request: ${request.type}`)
  })
  await drive.attach()
})
afterEach(() => {
  cleanup()
  drive.dispose()
  vi.clearAllMocks()
})

async function preview(path: string): Promise<void> {
  const fs = createFileSystem({ adapter: createMemoryAdapter({ [path]: "# Local preview\n" }), reportError: onError })
  const editor = createEditorController({ fs, confirmClose: async () => "cancel", reportError: onError })
  const document = await editor.open(path)
  const providers = scopedDrivePreviewProviders(
    {
      pdfWorkerSrc: "worker.js",
      resolveResource: async () => {
        throw new Error("Unexpected resource")
      }
    },
    host
  )
  const provider = providers.find((value) => value.id === "markdown")!
  const view = render(provider.render(document, context))
  const textbox = await within(view.container).findByRole("textbox", {}, { timeout: 10_000 })
  await act(async () => {})
  expect(textbox).toHaveTextContent("Local preview")
  expect(onError).not.toHaveBeenCalled()
  editor.dispose()
}

test.each([false, true])("Desktop Markdown does not probe Drive when running=%s", async (running) => {
  snapshot = { ...snapshot, running }
  await drive.refresh()
  await preview("/Users/test/Desktop/local.md")
  expect(bridge.request.mock.calls.map(([request]) => request.type)).not.toContain("collabSession")
})
test("local bytes in a stopped Drive remain previewable without a collaboration probe", async () => {
  await preview("/drive/One/local.md")
  expect(bridge.request.mock.calls.map(([request]) => request.type)).not.toContain("collabSession")
})
test("running indexed Drive Markdown still probes collaboration", async () => {
  snapshot = { ...snapshot, running: true }
  await drive.refresh()
  await preview("/drive/One/remote.md")
  expect(bridge.request).toHaveBeenCalledWith(
    expect.objectContaining({ type: "collabSession", path: "/drive/One/remote.md" })
  )
})
test("a sibling path with the same project prefix stays local", async () => {
  snapshot = { ...snapshot, running: true }
  await drive.refresh()
  await preview("/drive/One-other/local.md")
  expect(bridge.request.mock.calls.map(([request]) => request.type)).not.toContain("collabSession")
})

test("Desktop HTML renders without injecting the Drive comment bridge", async () => {
  const path = "/Users/test/Desktop/local.html"
  const fs = createFileSystem({ adapter: createMemoryAdapter({ [path]: "<h1>Local HTML</h1>" }), reportError: onError })
  const editor = createEditorController({ fs, confirmClose: async () => "cancel", reportError: onError })
  const loaded = await editor.open(path)
  const open = vi.fn(async (_path: string, _source: string) => ({
    url: "http://preview.test/local.html",
    dispose: async () => {}
  }))
  const providers = scopedDrivePreviewProviders(
    {
      pdfWorkerSrc: "worker.js",
      resolveResource: async () => {
        throw new Error("Unexpected resource")
      },
      htmlPreview: { open, subscribe: async () => () => {} }
    },
    host
  )
  render(providers.find((provider) => provider.id === "html")!.render(loaded, context))
  await waitFor(() => expect(document.querySelector("iframe")).toHaveAttribute("title", "local.html"))
  expect(open).toHaveBeenCalledOnce()
  expect(open.mock.calls[0]![1]).toContain("Local HTML")
  expect(open.mock.calls[0]![1]).not.toContain("__yupCommentBridge")
  expect(bridge.request.mock.calls.map(([request]) => request.type)).toEqual(["snapshot"])
  expect(onError).not.toHaveBeenCalled()
  editor.dispose()
})

test("simultaneous local and Drive previews select collaboration independently", async () => {
  snapshot = { ...snapshot, running: true }
  await drive.refresh()
  await preview("/drive/One/remote.md")
  await preview("/Users/test/Desktop/local.md")
  const sessions = bridge.request.mock.calls
    .map(([request]) => request)
    .filter((request) => request.type === "collabSession")
  expect(sessions).toEqual([expect.objectContaining({ path: "/drive/One/remote.md" })])
})
