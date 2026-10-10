import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, expect, test, vi } from "vitest"

const mock = vi.hoisted(() => ({
  connected: true,
  tauri: vi.fn(() => true),
  current: vi.fn<() => Promise<string[] | null>>(),
  receive: null as ((urls: string[]) => void) | null,
  changed: null as (() => void) | null,
  stop: vi.fn(),
  stopDrive: vi.fn(),
  snapshot: { configured: true, running: true, generation: 1, webBaseUrl: "https://drive.example.test" },
  request: vi.fn(),
  external: vi.fn(async (_url: string) => {}),
  error: vi.fn(),
  info: vi.fn()
}))
vi.mock("@tauri-apps/api/core", () => ({ isTauri: mock.tauri }))
vi.mock("@tauri-apps/plugin-deep-link", () => ({
  getCurrent: mock.current,
  onOpenUrl: async (handler: (urls: string[]) => void) => {
    mock.receive = handler
    return mock.stop
  }
}))
vi.mock("../controller", () => ({
  drive: {
    getSnapshot: () => ({ connected: mock.connected, snapshot: mock.snapshot }),
    request: mock.request,
    subscribe: (handler: () => void) => {
      mock.changed = handler
      return mock.stopDrive
    }
  }
}))
vi.mock("../filesystem", () => ({ driveFileSystem: vi.fn() }))
vi.mock("@/lib/open", () => ({ openExternal: mock.external }))
vi.mock("sonner", () => ({ toast: { error: mock.error, info: mock.info } }))
import { useDriveDeepLinks } from "../deep-links"

beforeEach(() => {
  vi.clearAllMocks()
  mock.connected = true
  mock.tauri.mockReturnValue(true)
  mock.receive = null
  mock.changed = null
  mock.snapshot = { configured: true, running: true, generation: 1, webBaseUrl: "https://drive.example.test" }
  mock.current.mockResolvedValue(null)
  mock.request.mockResolvedValue({ type: "path", data: "/drive/project/note.md" })
})

test("cold startup links wait until Drive is configured and running", async () => {
  mock.snapshot.running = false
  mock.current.mockResolvedValue(["alwith-u://yup-drive/file/7"])
  const open = vi.fn(async (_path: string) => {})
  const hook = renderHook(() => useDriveDeepLinks(open))
  await waitFor(() => expect(mock.current).toHaveBeenCalled())
  expect(open).not.toHaveBeenCalled()
  await act(async () => {
    mock.snapshot.running = true
    mock.changed?.()
  })
  await waitFor(() => expect(open).toHaveBeenCalledWith("/drive/project/note.md"))
  expect(mock.request).toHaveBeenCalledWith({ type: "localPath", fileId: 7 })
  hook.unmount()
  expect(mock.stop).toHaveBeenCalledOnce()
  expect(mock.stopDrive).toHaveBeenCalledOnce()
})

test("hot links and duplicate cold delivery open a file once", async () => {
  mock.current.mockResolvedValue(["alwith-u://yup-drive/file/7"])
  const open = vi.fn(async (_path: string) => {})
  renderHook(() => useDriveDeepLinks(open))
  await waitFor(() => expect(open).toHaveBeenCalledOnce())
  await act(async () => mock.receive?.(["alwith-u://yup-drive/file/7", "alwith-u://yup-drive/file/7"]))
  expect(open).toHaveBeenCalledOnce()
})

test("missing files use the configured safe web destination", async () => {
  mock.request.mockResolvedValue({ type: "path", data: null })
  mock.current.mockResolvedValue(["alwith-u://yup-drive/file/text-id"])
  const open = vi.fn(async (_path: string) => {})
  renderHook(() => useDriveDeepLinks(open))
  await waitFor(() => expect(mock.external).toHaveBeenCalledWith("https://drive.example.test/file/text-id"))
  expect(open).not.toHaveBeenCalled()
})

test("Desktop schemes and malformed U routes cannot open files", async () => {
  mock.current.mockResolvedValue([
    "alwith://yup-drive/file/7",
    "alwith-u://yup-drive/file/7?redirect=file:///etc/passwd"
  ])
  const open = vi.fn(async (_path: string) => {})
  renderHook(() => useDriveDeepLinks(open))
  await waitFor(() => expect(mock.error).toHaveBeenCalledOnce())
  expect(mock.request).not.toHaveBeenCalled()
  expect(open).not.toHaveBeenCalled()
})

test("an account change while resolving discards the previous account's local path", async () => {
  let finish: ((value: { type: "path"; data: string }) => void) | undefined
  mock.request.mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  mock.current.mockResolvedValue(["alwith-u://yup-drive/file/7"])
  const open = vi.fn(async (_path: string) => {})
  renderHook(() => useDriveDeepLinks(open))
  await waitFor(() => expect(mock.request).toHaveBeenCalledOnce())
  await act(async () => {
    mock.snapshot.generation++
    finish?.({ type: "path", data: "/old-account/private.md" })
  })
  expect(open).not.toHaveBeenCalled()
  expect(mock.external).not.toHaveBeenCalled()
  expect(mock.error).toHaveBeenCalledWith(expect.stringContaining("profile changed"))
})

test("ordinary browser renders never call native deep-link APIs", async () => {
  mock.tauri.mockReturnValue(false)
  const open = vi.fn(async (_path: string) => {})
  const hook = renderHook(() => useDriveDeepLinks(open))
  expect(mock.receive).toBeNull()
  expect(mock.changed).toBeNull()
  expect(mock.current).not.toHaveBeenCalled()
  expect(mock.request).not.toHaveBeenCalled()
  expect(mock.error).not.toHaveBeenCalled()
  hook.unmount()
})

test("cold links remain queued until the controller attaches", async () => {
  mock.connected = false
  mock.current.mockResolvedValue(["alwith-u://yup-drive/file/7"])
  const open = vi.fn(async (_path: string) => {})
  renderHook(() => useDriveDeepLinks(open))
  await act(async () => {})
  expect(mock.request).not.toHaveBeenCalled()
  expect(mock.external).not.toHaveBeenCalled()
  await act(async () => {
    mock.connected = true
    mock.changed?.()
  })
  await waitFor(() => expect(open).toHaveBeenCalledWith("/drive/project/note.md"))
  expect(mock.error).not.toHaveBeenCalled()
})
