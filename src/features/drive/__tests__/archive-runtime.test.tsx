import { act, renderHook, waitFor } from "@testing-library/react"
import type { DriveRequest, DriveResponse, Snapshot } from "@alwith/module-drive"
import { afterEach, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  listeners: new Set<() => void>(),
  callbacks: new Map<string, () => void>(),
  error: vi.fn(),
  list: vi.fn(),
  request: vi.fn<(request: DriveRequest) => Promise<DriveResponse>>()
}))
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }))
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, callback: () => void) => {
    mocks.callbacks.set(name, callback)
    return () => mocks.callbacks.delete(name)
  }
}))
vi.mock("sonner", () => ({ toast: { error: mocks.error } }))
vi.mock("@/lib/client", () => ({
  client: {
    state: { connection: "ready" },
    store: {
      subscribe: (listener: () => void) => {
        mocks.listeners.add(listener)
        return () => mocks.listeners.delete(listener)
      }
    },
    listHistorySessions: mocks.list,
    exportHistory: vi.fn()
  }
}))
vi.mock("../controller", async () => {
  const { createDriveController } = await import("@alwith/module-drive")
  return { drive: createDriveController({ request: mocks.request, subscribe: async () => () => {} }) }
})
import { drive } from "../controller"
import { DRIVE_ARCHIVE_SYNC, useDriveArchive } from "../archive-runtime"

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
afterEach(() => {
  drive.dispose()
  mocks.request.mockReset()
  mocks.error.mockReset()
  mocks.list.mockReset()
  mocks.callbacks.clear()
  vi.useRealTimers()
})

test("startup archive waits for attachment, then checks consent without reporting a connection error", async () => {
  mocks.request.mockImplementation(async request =>
    request.type === "snapshot"
      ? { type: "snapshot", data: snapshot }
      : { type: "preferences", data: { sessionArchive: false, knowledgeInject: false } }
  )
  const view = renderHook(() => useDriveArchive())
  await act(() => drive.attach())
  await waitFor(() => expect(mocks.request).toHaveBeenCalledWith({ type: "preferences" }))
  expect(mocks.error).not.toHaveBeenCalled()
  expect(mocks.list).not.toHaveBeenCalled()
  view.unmount()
})

test("timer and manual archive triggers do not request a disconnected service", async () => {
  vi.useFakeTimers()
  const view = renderHook(() => useDriveArchive())
  await act(async () => {
    mocks.callbacks.get(DRIVE_ARCHIVE_SYNC)?.()
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
  })
  expect(mocks.request).not.toHaveBeenCalled()
  expect(mocks.error).not.toHaveBeenCalled()
  expect(mocks.list).not.toHaveBeenCalled()
  view.unmount()
})

test("a real archive preference failure after attachment remains visible", async () => {
  mocks.request.mockImplementation(async request => {
    if (request.type === "snapshot") return { type: "snapshot", data: snapshot }
    throw new Error("Preference storage unavailable")
  })
  const view = renderHook(() => useDriveArchive())
  await act(() => drive.attach())
  await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("Error: Preference storage unavailable"))
  expect(mocks.list).not.toHaveBeenCalled()
  view.unmount()
})
