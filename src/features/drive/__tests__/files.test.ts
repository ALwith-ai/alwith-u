import { beforeEach, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(async (_controller: unknown, path: string) => path as string | null),
  request: vi.fn(),
  snapshot: vi.fn(() => ({ snapshot: { generation: 1, webBaseUrl: "https://drive.example.test" } })),
  external: vi.fn(async (_url: string) => {}),
  read: vi.fn(),
  info: vi.fn()
}))
vi.mock("@alwith/module-drive", () => ({ prepareDriveFile: mocks.prepare }))
vi.mock("../controller", () => ({ drive: { request: mocks.request, getSnapshot: mocks.snapshot } }))
vi.mock("../filesystem", () => ({ driveFileSystem: async () => ({ readFile: mocks.read }) }))
vi.mock("@/lib/open", () => ({ openExternal: mocks.external }))
vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: vi.fn() }))
vi.mock("sonner", () => ({ toast: { info: mocks.info } }))

import { prepareWorkspaceFile } from "../files"
const shortcut = (targetFileId: number, webUrl = "https://stored.example.test/file") =>
  new TextEncoder().encode(JSON.stringify({ targetFileId, name: "stale name", webUrl }))
beforeEach(() => {
  vi.clearAllMocks()
  mocks.prepare.mockImplementation(async (_controller: unknown, path: string) => path)
  mocks.snapshot.mockReturnValue({ snapshot: { generation: 1, webBaseUrl: "https://drive.example.test" } })
  mocks.read.mockResolvedValue(shortcut(7))
  mocks.request.mockResolvedValue({ type: "path", data: null })
})

test("ordinary files keep the existing preparation flow", async () => {
  expect(await prepareWorkspaceFile("/project/note.md")).toBe("/project/note.md")
  expect(mocks.read).not.toHaveBeenCalled()
  expect(mocks.request).not.toHaveBeenCalled()
})

test("shortcut opens the current native target through the workspace host", async () => {
  const readFile = vi.fn(async () => shortcut(7))
  const openTarget = vi.fn(async (_path: string) => {})
  mocks.request.mockResolvedValue({ type: "path", data: "/other-project/renamed.md" })
  expect(await prepareWorkspaceFile("/project/old.yuplink", { readFile, openTarget })).toBeNull()
  expect(mocks.request).toHaveBeenCalledWith({ type: "localPath", fileId: 7 })
  expect(openTarget).toHaveBeenCalledWith("/other-project/renamed.md")
  expect(mocks.external).not.toHaveBeenCalled()
})

test("missing targets prefer the current configured web destination", async () => {
  mocks.read.mockResolvedValue(shortcut(7, "javascript:alert(1)"))
  expect(await prepareWorkspaceFile("/project/a.yuplink")).toBeNull()
  expect(mocks.external).toHaveBeenCalledWith("https://drive.example.test/file/7")
})

test.each([
  "javascript:alert(1)",
  "file:///etc/passwd",
  "alwith://yup-drive/file/7",
  "https://user:secret@example.test/file"
])("unsafe shortcut fallback is rejected: %s", async webUrl => {
  mocks.snapshot.mockReturnValue({ snapshot: { generation: 1, webBaseUrl: "" } })
  mocks.read.mockResolvedValue(shortcut(7, webUrl))
  await expect(prepareWorkspaceFile("/project/a.yuplink")).rejects.toThrow("safe web destination")
  expect(mocks.external).not.toHaveBeenCalled()
})

test("unavailable native lookup still offers the safe web fallback", async () => {
  mocks.request.mockRejectedValue(new Error("Drive stopped"))
  expect(await prepareWorkspaceFile("/project/a.yuplink")).toBeNull()
  expect(mocks.external).toHaveBeenCalledWith("https://drive.example.test/file/7")
  expect(mocks.info).toHaveBeenCalled()
})

test("malformed shortcuts never open external destinations", async () => {
  mocks.read.mockResolvedValue(new TextEncoder().encode("not JSON"))
  await expect(prepareWorkspaceFile("/project/a.yuplink")).rejects.toThrow("damaged")
  expect(mocks.external).not.toHaveBeenCalled()
})

test("self and multi-file link cycles terminate without opening a target", async () => {
  mocks.read.mockImplementation(async (path: string) => shortcut(path.endsWith("a.yuplink") ? 1 : 2))
  mocks.request.mockImplementation(async ({ fileId }: { fileId: number }) => ({
    type: "path",
    data: fileId === 1 ? "/project/b.yuplink" : "/project/a.yuplink"
  }))
  await expect(prepareWorkspaceFile("/project/a.yuplink")).rejects.toThrow("loop")
  expect(mocks.request).toHaveBeenCalledTimes(2)
  expect(mocks.external).not.toHaveBeenCalled()
})

test("cancelled placeholder download does not read the shortcut", async () => {
  mocks.prepare.mockResolvedValue(null)
  expect(await prepareWorkspaceFile("/project/a.yuplink.yupcloud")).toBeNull()
  expect(mocks.read).not.toHaveBeenCalled()
})

test("switching accounts while reading a shortcut prevents any target lookup", async () => {
  const openTarget = vi.fn(async (_path: string) => {})
  const readFile = vi.fn(async () => {
    mocks.snapshot.mockReturnValue({ snapshot: { generation: 2, webBaseUrl: "https://other.example.test" } })
    return shortcut(7)
  })
  await expect(prepareWorkspaceFile("/project/a.yuplink", { readFile, openTarget })).rejects.toThrow("profile changed")
  expect(mocks.request).not.toHaveBeenCalled()
  expect(openTarget).not.toHaveBeenCalled()
  expect(mocks.external).not.toHaveBeenCalled()
})

test.each([null, "/other-account/private.md"])(
  "switching accounts during target lookup rejects local and web navigation: %s",
  async destination => {
    mocks.request.mockImplementation(async () => {
      mocks.snapshot.mockReturnValue({ snapshot: { generation: 2, webBaseUrl: "https://other.example.test" } })
      return { type: "path", data: destination }
    })
    const openTarget = vi.fn(async (_path: string) => {})
    await expect(
      prepareWorkspaceFile("/project/a.yuplink", { readFile: async () => shortcut(7), openTarget })
    ).rejects.toThrow("profile changed")
    expect(openTarget).not.toHaveBeenCalled()
    expect(mocks.external).not.toHaveBeenCalled()
  }
)
