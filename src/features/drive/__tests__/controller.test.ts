import type { DriveRequest, DriveResponse, Snapshot } from "@alwith/module-drive"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args: { request: DriveRequest }) => Promise<DriveResponse>>(),
  success: vi.fn()
}))
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: async () => {}, listen: () => Promise.resolve(() => {}) }))
vi.mock("sonner", () => ({ toast: { success: mocks.success } }))

import { drive } from "../controller"

const snapshot: Snapshot = {
  version: 1,
  generation: 1,
  sequence: 0,
  configured: true,
  running: false,
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
beforeEach(async () => {
  mocks.success.mockClear()
  mocks.invoke.mockImplementation((_command, { request }) => {
    if (request.type === "snapshot") return Promise.resolve({ type: "snapshot", data: snapshot })
    if (request.type === "configuration")
      return Promise.resolve({
        type: "configuration",
        data: { userId: "1", deviceId: "device", userName: "Test", clientConfig: null }
      })
    return Promise.resolve({ type: "done" })
  })
  await drive.attach()
})
afterEach(() => drive.dispose())

test("configuration success toast waits for the confirmed save response", async () => {
  let finish!: (response: DriveResponse) => void
  let generation = 1
  mocks.invoke.mockImplementation(async (_command, { request }) => {
    if (request.type === "snapshot") return { type: "snapshot", data: { ...snapshot, generation } }
    if (request.type === "configuration")
      return { type: "configuration", data: { userId: "1", deviceId: "device", userName: "Test", clientConfig: null } }
    return new Promise((resolve) => {
      finish = resolve
    })
  })
  const save = drive.request({ type: "setMaxAutoDownloadMb", megabytes: 50 })
  await vi.waitFor(() => expect(finish).toBeDefined())
  expect(mocks.success).not.toHaveBeenCalled()
  generation = 3
  finish({ type: "maxAutoDownloadMb", data: 50 })
  await save
  expect(mocks.success).toHaveBeenCalledOnce()
  expect(drive.getSnapshot().snapshot?.generation).toBe(3)
})

test("failed configuration saves propagate the error without a success toast", async () => {
  mocks.invoke.mockImplementation((_command, { request }) => {
    return Promise.try(() => {
      if (request.type === "snapshot") return { type: "snapshot", data: snapshot }
      if (request.type === "configuration")
        return {
          type: "configuration",
          data: { userId: "1", deviceId: "device", userName: "Test", clientConfig: null }
        }
      throw new Error("Cannot save settings")
    })
  })
  await expect(drive.request({ type: "setPreferences", sessionArchive: true, knowledgeInject: false })).rejects.toThrow(
    "Cannot save settings"
  )
  expect(mocks.success).not.toHaveBeenCalled()
})

test("background configuration reads do not show save notifications", async () => {
  await drive.request({ type: "configuration" })
  expect(mocks.success).not.toHaveBeenCalled()
})
