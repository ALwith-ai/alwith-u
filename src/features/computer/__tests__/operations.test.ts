// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest"
const native = vi.hoisted(() => ({ computerStart: vi.fn(), computerStop: vi.fn(), computerStatus: vi.fn() }))
const settings = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }))
vi.mock("@/bindings", () => ({ commands: native }))
vi.mock("@/lib/settings-store", () => ({ settingsStore: { get: settings.get }, updateSettings: settings.update }))
import { enableComputer, restoreComputer, stopComputer } from "../operations"
beforeEach(() => vi.resetAllMocks())
test("global enable saves its preference only after native startup succeeds", async () => {
  await enableComputer()
  expect(native.computerStart).toHaveBeenCalledExactlyOnceWith()
  expect(settings.update).toHaveBeenCalledExactlyOnceWith({ "computer.enabled": true })
})
test("global stop revokes native authority and saves the disabled preference", async () => {
  await stopComputer()
  expect(native.computerStop).toHaveBeenCalledExactlyOnceWith()
  expect(settings.update).toHaveBeenCalledExactlyOnceWith({ "computer.enabled": false })
})
test("native failures do not persist an enabled preference", async () => {
  native.computerStart.mockRejectedValue(new Error("missing permission"))
  await expect(enableComputer()).rejects.toThrow("missing permission")
  expect(settings.update).not.toHaveBeenCalled()
})
test("a failed save rolls back native enablement", async () => {
  settings.update.mockRejectedValue(new Error("disk full"))
  await expect(enableComputer()).rejects.toThrow("disk full")
  expect(native.computerStop).toHaveBeenCalledOnce()
})
test("restart restores the saved switch only while system permissions remain granted", async () => {
  settings.get.mockReturnValue(true)
  const status = { enabled: false, available: true, permissions: { supported: true, accessibility: true, screenCapture: true } }
  native.computerStatus.mockResolvedValue(status)
  await restoreComputer()
  expect(native.computerStart).toHaveBeenCalledOnce()
  expect(settings.update).not.toHaveBeenCalled()
  native.computerStart.mockClear()
  native.computerStatus.mockResolvedValue({ ...status, permissions: { ...status.permissions, screenCapture: false } })
  await restoreComputer()
  expect(native.computerStart).not.toHaveBeenCalled()
  settings.get.mockReturnValue(false)
  native.computerStatus.mockClear()
  await restoreComputer()
  expect(native.computerStatus).not.toHaveBeenCalled()
})
