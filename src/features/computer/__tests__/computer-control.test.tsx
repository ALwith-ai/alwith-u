import type { ComputerStatus_Serialize as ComputerStatus } from "@alwith/module-computer/commands"
import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

const native = vi.hoisted(() => ({
  computerStatus: vi.fn(),
  computerStart: vi.fn(),
  computerStop: vi.fn()
}))
const settings = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }))
vi.mock("@alwith/module-computer/commands", () => ({
  commands: { status: native.computerStatus, start: native.computerStart, stop: native.computerStop }
}))
vi.mock("@/lib/settings-store", () => ({
  settingsStore: { get: settings.get },
  updateSettings: settings.update
}))

import { useComputerStatus } from "../computer-control"
import { stopComputer } from "../operations"

let status: ComputerStatus
beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
  status = {
    available: true,
    enabled: false,
    phase: "disabled",
    driverPhase: "disabled",
    connections: { ready: 0, connecting: 0, disconnected: 0, failed: 0 },
    version: "test",
    lastError: null,
    diagnostics: "",
    permissions: { supported: true, accessibility: true, screenCapture: true }
  }
  native.computerStatus.mockImplementation(async () => structuredClone(status))
  native.computerStart.mockImplementation(async () => {
    status.enabled = true
    status.phase = "ready"
  })
  native.computerStop.mockImplementation(async () => {
    status.enabled = false
    status.phase = "disabled"
  })
  settings.update.mockImplementation(async (changes: Record<string, boolean>) => {
    settings.get.mockReturnValue(changes["computer.enabled"])
  })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

async function poll(milliseconds = 0) {
  await act(() => vi.advanceTimersByTimeAsync(milliseconds))
}

test("fresh settings stay disabled even when both permissions are already granted", async () => {
  const view = renderHook(useComputerStatus)
  await poll()
  expect(native.computerStart).not.toHaveBeenCalled()
  expect(view.result.current.status?.enabled).toBe(false)
  await poll(3000)
  expect(native.computerStart).not.toHaveBeenCalled()
})

test("a saved enabled choice starts after both permissions become available", async () => {
  settings.get.mockReturnValue(true)
  status.permissions.accessibility = false
  status.permissions.screenCapture = false
  const view = renderHook(useComputerStatus)
  await poll()
  status.permissions.accessibility = true
  await poll(1000)
  expect(native.computerStart).not.toHaveBeenCalled()
  status.permissions.screenCapture = true
  await poll(1000)
  expect(native.computerStart).toHaveBeenCalledOnce()
  expect(view.result.current.status?.phase).toBe("ready")
})

test("manual disable survives polling, permission changes and reopening settings", async () => {
  settings.get.mockReturnValue(true)
  const view = renderHook(useComputerStatus)
  await poll()
  await act(stopComputer)
  await poll(2000)
  expect(view.result.current.status?.enabled).toBe(false)
  status.permissions.screenCapture = false
  await poll(1000)
  status.permissions.screenCapture = true
  await poll(1000)
  view.unmount()
  const reopened = renderHook(useComputerStatus)
  await poll()
  expect(reopened.result.current.status?.enabled).toBe(false)
  expect(native.computerStart).toHaveBeenCalledOnce()
})

test("a saved disabled choice prevents automatic startup with both permissions", async () => {
  settings.get.mockReturnValue(false)
  const view = renderHook(useComputerStatus)
  await poll()
  expect(native.computerStart).not.toHaveBeenCalled()
  expect(view.result.current.status?.enabled).toBe(false)
})

test.each(["failed", "verifying", "stopping"])("polling never restarts a driver in phase %s", async (phase) => {
  settings.get.mockReturnValue(true)
  status.phase = phase
  renderHook(useComputerStatus)
  await poll(3000)
  expect(native.computerStart).not.toHaveBeenCalled()
})

test("failed automatic verification is visible and is not retried every second", async () => {
  settings.get.mockReturnValue(true)
  native.computerStart.mockImplementation(async () => {
    status.phase = "failed"
    status.lastError = "capture unavailable"
    throw new Error(status.lastError)
  })
  const view = renderHook(useComputerStatus)
  await poll()
  expect(view.result.current.error).toContain("capture unavailable")
  await poll(3000)
  expect(view.result.current.status?.lastError).toBe("capture unavailable")
  expect(native.computerStart).toHaveBeenCalledOnce()
})

test("unmounting during a permission query prevents a late automatic start", async () => {
  settings.get.mockReturnValue(true)
  let resolve!: (value: ComputerStatus) => void
  native.computerStatus.mockImplementationOnce(
    () =>
      new Promise<ComputerStatus>((done) => {
        resolve = done
      })
  )
  const view = renderHook(useComputerStatus)
  view.unmount()
  await act(async () => resolve(status))
  await poll(3000)
  expect(native.computerStart).not.toHaveBeenCalled()
  expect(native.computerStatus).toHaveBeenCalledOnce()
})
