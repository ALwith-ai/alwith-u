import i18n from "i18next"
import { initReactI18next } from "react-i18next"
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react"
import type { DriveRequest, DriveResponse, Snapshot } from "@alwith/module-drive"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

const mock = vi.hoisted(() => ({
  request: vi.fn<(request: DriveRequest) => Promise<DriveResponse>>(),
  error: vi.fn()
}))
vi.mock("../use-drive-visible", () => ({ useDriveVisible: () => true }))
vi.mock("sonner", () => ({ toast: { error: mock.error } }))
vi.mock("../controller", async () => {
  const { createDriveController } = await import("@alwith/module-drive")
  const transport = { request: mock.request, subscribe: async () => () => {} }
  return { drive: createDriveController(transport), driveTransport: transport }
})
import { drive } from "../controller"
import { useDriveContentHost } from "../content-host"
import { DriveIntegrations } from "../integrations"
import { DriveArchiveAction } from "../archive-action"
import { DriveStatus } from "../drive"

const snapshot: Snapshot = {
  version: 1,
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
  mock.request.mockImplementation(async request => {
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
afterEach(() => {
  cleanup()
  drive.dispose()
  snapshot.status = null
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

test("configuration failures after attachment remain visible", async () => {
  await drive.attach()
  mock.request.mockRejectedValue(new Error("Configuration unavailable"))
  renderHook(() => useDriveContentHost(save))
  await waitFor(() => expect(mock.error).toHaveBeenCalledWith("Error: Configuration unavailable"))
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
