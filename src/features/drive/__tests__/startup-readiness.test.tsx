import { CONTRACT_VERSION } from "@alwith/module-drive"
import type { DriveRequest, DriveResponse, Snapshot } from "@alwith/module-drive"
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react"
import i18n from "i18next"
import { initReactI18next } from "react-i18next"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

const mock = vi.hoisted(() => ({
  request: vi.fn<(request: DriveRequest) => Promise<DriveResponse>>(),
  error: vi.fn()
}))
vi.mock("../use-drive-visible", () => ({ useDriveVisible: () => true }))
vi.mock("sonner", () => ({ toast: { error: mock.error } }))
vi.mock("../controller", async () => {
  const { createDriveController } = await import("@alwith/module-drive")
  const transport = { request: mock.request, subscribe: () => Promise.resolve(() => {}) }
  return { drive: createDriveController(transport), driveTransport: transport }
})

import { error as logError } from "@tauri-apps/plugin-log"

import { DriveArchiveAction } from "../archive-action"
import { useDriveContentHost } from "../content-host"
import { drive } from "../controller"
import { DriveStatus, useDriveConnection } from "../drive"
import { DriveIntegrations } from "../integrations"

const snapshot: Snapshot = {
  version: CONTRACT_VERSION,
  generation: 1,
  sequence: 0,
  configured: true,
  running: true,
  baseUrl: "https://drive.test",
  localRoot: "/drive",
  webBaseUrl: null,
  status: null,
  roots: [],
  files: [],
  projects: [],
  pendingDeletes: [],
  error: null
}
const save = async (_path: string): Promise<void> => {}

beforeEach(async () => {
  await i18n.use(initReactI18next).init({ lng: "en", resources: { en: { translation: {} } } })
  mock.request.mockImplementation((request) => {
    return Promise.try(() => {
      switch (request.type) {
        case "snapshot":
          return { type: "snapshot", data: snapshot }
        case "configuration":
          return {
            type: "configuration",
            data: { deviceId: "test", userId: "1", userName: "Test User", clientConfig: null }
          }
        case "preferences":
          return { type: "preferences", data: { sessionArchive: false, knowledgeInject: false } }
        case "archiveStatus":
          return {
            type: "archiveStatus",
            data: {
              enabled: false,
              syncing: false,
              lastRunAt: null,
              lastUploadAt: null,
              synced: 0,
              lastUploaded: 0,
              lastError: null,
              mode: null
            }
          }
        case "archivePrivateSessions":
          return { type: "archivePrivateSessions", data: [] }
        case "failedUploads":
          return { type: "failedUploads", data: [] }
        default:
          throw new Error(`Unexpected request: ${request.type}`)
      }
    })
  })
})
afterEach(() => {
  cleanup()
  drive.dispose()
  snapshot.status = null
  snapshot.error = null
  vi.clearAllMocks()
})

test("content identity waits for attachment and loads when only connected changes", async () => {
  // Hold the real controller at the snapshot-published stage of attachment.
  await drive.refresh()
  const view = renderHook(() => useDriveContentHost(save))
  await act(async () => {})
  expect(mock.error).not.toHaveBeenCalled()
  expect(view.result.current.userName).toBe("")
  await act(() => drive.attach())
  await waitFor(() => expect(view.result.current.userName).toBe("Test User"))
  expect(mock.error).not.toHaveBeenCalled()
})

test("startup finishes engine initialization before exposing configuration reads", async () => {
  vi.stubGlobal("isTauri", true)
  const started = Promise.withResolvers<void>()
  const finish = Promise.withResolvers<void>()
  const previousConfiguration = Promise.withResolvers<DriveResponse>()
  const handle = mock.request.getMockImplementation()!
  let generation = 1
  let starting = true
  mock.request.mockImplementation(async (request): Promise<DriveResponse> => {
    if (request.type === "snapshot") return { type: "snapshot", data: { ...snapshot, generation, running: !starting } }
    if (request.type === "start") {
      generation = 2
      started.resolve()
      await finish.promise
      starting = false
      return { type: "snapshot", data: { ...snapshot, generation, running: true } }
    }
    if (request.type === "refreshClientConfig") {
      generation = 3
      return { type: "done" }
    }
    if (request.type === "configuration") {
      if (starting) return previousConfiguration.promise
      return {
        type: "configuration",
        data: { deviceId: "test", userId: "1", userName: "Current User", clientConfig: null }
      }
    }
    return handle(request)
  })
  try {
    const view = renderHook(() => {
      useDriveConnection()
      return useDriveContentHost(save)
    })
    await act(() => started.promise)
    await act(async () => {
      previousConfiguration.resolve({
        type: "configuration",
        data: { deviceId: "test", userId: "1", userName: "Previous User", clientConfig: null }
      })
    })
    const initializingUserName = view.result.current.userName
    await act(async () => finish.resolve())
    await waitFor(() => expect(view.result.current.userName).toBe("Current User"))
    expect(initializingUserName).toBe("")
    expect(mock.error).not.toHaveBeenCalled()
  } finally {
    finish.resolve()
    vi.unstubAllGlobals()
  }
})

test("configuration failures after attachment remain visible", async () => {
  await drive.attach()
  mock.request.mockRejectedValue(new Error("Configuration unavailable"))
  renderHook(() => useDriveContentHost(save))
  await waitFor(() => expect(mock.error).toHaveBeenCalledWith("Error: Configuration unavailable"))
})

test("an incompatible service never starts the engine", async () => {
  vi.stubGlobal("isTauri", true)
  mock.request.mockResolvedValue({ type: "snapshot", data: { ...snapshot, version: CONTRACT_VERSION + 1 } })
  try {
    renderHook(() => useDriveConnection())
    await waitFor(() => expect(drive.getSnapshot().error).toBe("Incompatible Drive contract"))
    expect(drive.getSnapshot().connected).toBe(false)
    expect(mock.request).not.toHaveBeenCalledWith({ type: "start" })
    expect(mock.request).not.toHaveBeenCalledWith({ type: "refreshClientConfig" })
  } finally {
    vi.unstubAllGlobals()
  }
})

test("integration settings stay pending until attachment and then enable controls", async () => {
  await drive.refresh()
  render(<DriveIntegrations />)
  await act(async () => {})
  expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  for (const control of screen.getAllByRole("switch")) expect(control).toHaveAttribute("aria-disabled", "true")
  await act(() => drive.attach())
  await waitFor(() => {
    for (const control of screen.getAllByRole("switch")) expect(control).not.toHaveAttribute("aria-disabled", "true")
  })
})

test("failed upload status waits for attachment even when startup has failures", async () => {
  snapshot.status = {
    state: { kind: "idle" },
    pending: 0,
    uploading: 0,
    downloading: 0,
    synced: 0,
    failed: 1,
    conflicts: [],
    errors: [],
    lastSyncAt: null,
    pushConnected: false
  }
  await drive.refresh()
  render(<DriveStatus />)
  await act(async () => {})
  expect(mock.error).not.toHaveBeenCalled()
  await act(() => drive.attach())
  await waitFor(() => expect(mock.request).toHaveBeenCalledWith({ type: "failedUploads" }))
  expect(mock.error).not.toHaveBeenCalled()
})

test("session archive action waits for attachment before reading private sessions", async () => {
  await drive.refresh()
  render(<DriveArchiveAction sessionId="chat-1" />)
  await act(async () => {})
  expect(mock.error).not.toHaveBeenCalled()
  expect(screen.getByRole("button")).toBeDisabled()
  await act(() => drive.attach())
  await waitFor(() => expect(screen.getByRole("button")).not.toBeDisabled())
  expect(mock.error).not.toHaveBeenCalled()
})

test("startup errors stay in the status bar and do not open a notification", async () => {
  snapshot.error = "Drive directory unavailable"
  await drive.attach()
  render(<DriveStatus />)
  expect(screen.getByRole("button", { name: "YUP Drive" })).toHaveTextContent("Sync error")
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  expect(mock.error).not.toHaveBeenCalled()
})

test("failed transfer list refresh is logged without a toast", async () => {
  snapshot.status = {
    state: { kind: "idle" },
    pending: 0,
    uploading: 0,
    downloading: 0,
    synced: 0,
    failed: 1,
    conflicts: [],
    errors: [],
    lastSyncAt: null,
    pushConnected: false
  }
  const handle = mock.request.getMockImplementation()!
  mock.request.mockImplementation((request) =>
    request.type === "failedUploads" ? Promise.reject(new Error("Failure list unavailable")) : handle(request)
  )
  await drive.attach()
  render(<DriveStatus />)
  await waitFor(() => expect(logError).toHaveBeenCalledWith(expect.stringContaining("Failure list unavailable")))
  expect(mock.error).not.toHaveBeenCalled()
})

test("background startup failure is logged without a toast", async () => {
  vi.stubGlobal("isTauri", true)
  const handle = mock.request.getMockImplementation()!
  mock.request.mockImplementation((request) => {
    if (request.type === "start") {
      snapshot.error = "Drive startup unavailable"
      return Promise.reject(new Error(snapshot.error))
    }
    return handle(request)
  })
  try {
    renderHook(() => useDriveConnection())
    render(<DriveStatus />)
    await waitFor(() => expect(logError).toHaveBeenCalledWith(expect.stringContaining("Drive startup unavailable")))
    await waitFor(() => expect(drive.getSnapshot().connected).toBe(true))
    expect(screen.getByRole("button", { name: "YUP Drive" })).toHaveTextContent("Sync error")
    expect(mock.error).not.toHaveBeenCalled()
  } finally {
    vi.unstubAllGlobals()
  }
})
