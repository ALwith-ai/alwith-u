// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest"
const native = vi.hoisted(() => ({
  computerStart: vi.fn(),
  computerReconnect: vi.fn(),
  computerStop: vi.fn(),
  computerStatus: vi.fn()
}))
const settings = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }))
vi.mock("@/bindings", () => ({ commands: native }))
vi.mock("@/lib/settings-store", () => ({
  settingsStore: { get: settings.get },
  updateSettings: settings.update
}))
import { enableComputer, reconnectComputer, restoreComputer, stopComputer } from "../operations"
beforeEach(() => {
  vi.resetAllMocks()
  native.computerStart.mockResolvedValue(undefined)
  native.computerReconnect.mockResolvedValue(undefined)
  native.computerStop.mockResolvedValue(undefined)
  settings.update.mockResolvedValue(undefined)
})
test("global enable saves its preference only after native startup succeeds", async () => {
  await enableComputer()
  expect(native.computerStart).toHaveBeenCalledExactlyOnceWith()
  expect(settings.update).toHaveBeenCalledExactlyOnceWith({
    "computer.enabled": true
  })
})
test("global stop revokes native authority and saves the disabled preference", async () => {
  await stopComputer()
  expect(native.computerStop).toHaveBeenCalledExactlyOnceWith()
  expect(settings.update).toHaveBeenCalledExactlyOnceWith({
    "computer.enabled": false
  })
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
  const status = {
    enabled: false,
    available: true,
    permissions: { supported: true, accessibility: true, screenCapture: true }
  }
  native.computerStatus.mockResolvedValue(status)
  await restoreComputer()
  expect(native.computerStart).toHaveBeenCalledOnce()
  expect(settings.update).not.toHaveBeenCalled()
  native.computerStart.mockClear()
  native.computerStatus.mockResolvedValue({
    ...status,
    permissions: { ...status.permissions, screenCapture: false }
  })
  await restoreComputer()
  expect(native.computerStart).not.toHaveBeenCalled()
  settings.get.mockReturnValue(false)
  native.computerStatus.mockClear()
  await restoreComputer()
  expect(native.computerStatus).not.toHaveBeenCalled()
})

test("reconnect persists enablement only after native verification and never sends a chat action", async () => {
  await reconnectComputer()
  expect(native.computerReconnect).toHaveBeenCalledOnce()
  expect(settings.update).toHaveBeenCalledWith({ "computer.enabled": true })
  expect(native.computerStart).not.toHaveBeenCalled()
})
test("failed reconnect keeps the previous preference and propagates the capability failure", async () => {
  native.computerReconnect.mockRejectedValue(new Error("capture unavailable"))
  await expect(reconnectComputer()).rejects.toThrow("capture unavailable")
  expect(settings.update).not.toHaveBeenCalled()
})
test("reconnect rolls back the driver if saving the enabled preference fails", async () => {
  settings.update.mockRejectedValue(new Error("disk full"))
  await expect(reconnectComputer()).rejects.toThrow("disk full")
  expect(native.computerStop).toHaveBeenCalledOnce()
})

function gate() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

test.each([enableComputer, reconnectComputer])(
  "stop waits for an in-flight grant and leaves the saved preference disabled (%#)",
  async (grant) => {
    const started = gate()
    const pending = gate()
    const start = async () => {
      started.resolve()
      await pending.promise
    }
    native.computerStart.mockImplementation(start)
    native.computerReconnect.mockImplementation(start)
    const granting = grant()
    await started.promise
    const stopping = stopComputer()
    pending.resolve()
    await Promise.all([granting, stopping])
    expect(settings.update).toHaveBeenLastCalledWith({ "computer.enabled": false })
  }
)

test("a delayed restore check cannot start the driver after global stop completes", async () => {
  settings.get.mockReturnValue(true)
  const queried = gate()
  const pending = gate()
  const calls: string[] = []
  native.computerStatus.mockImplementation(async () => {
    queried.resolve()
    await pending.promise
    return {
      enabled: false,
      available: true,
      permissions: { supported: true, accessibility: true, screenCapture: true }
    }
  })
  native.computerStart.mockImplementation(async () => {
    calls.push("start")
  })
  native.computerStop.mockImplementation(async () => {
    calls.push("stop")
  })
  const restoring = restoreComputer()
  await queried.promise
  const stopping = stopComputer()
  pending.resolve()
  await Promise.all([restoring, stopping])
  expect(calls.at(-1)).toBe("stop")
})

test("failed rollback preserves both the save error and the native stop error", async () => {
  const save = new Error("disk full")
  const stop = new Error("driver stop failed")
  settings.update.mockRejectedValue(save)
  native.computerStop.mockRejectedValueOnce(stop)
  await expect(enableComputer()).rejects.toMatchObject({ errors: [save, stop] })
})

test("a failed native stop does not claim the preference was disabled", async () => {
  native.computerStop.mockRejectedValueOnce(new Error("driver stop failed"))
  await expect(stopComputer()).rejects.toThrow("driver stop failed")
  expect(settings.update).not.toHaveBeenCalled()
  await enableComputer()
  expect(settings.update).toHaveBeenLastCalledWith({ "computer.enabled": true })
})

test("the next transition waits for rollback finalization and proceeds after cleanup fails", async () => {
  const cleanupStarted = gate()
  const cleanupFinished = gate()
  const saveError = new Error("save failed")
  const cleanupError = new Error("cleanup failed")
  settings.update.mockRejectedValueOnce(saveError)
  native.computerStop.mockImplementationOnce(async () => {
    cleanupStarted.resolve()
    await cleanupFinished.promise
    throw cleanupError
  })
  const enabling = enableComputer().catch((error: unknown) => error)
  await cleanupStarted.promise
  const reconnecting = reconnectComputer()
  await Promise.resolve()
  expect(native.computerReconnect).not.toHaveBeenCalled()
  cleanupFinished.resolve()
  expect(await enabling).toMatchObject({ errors: [saveError, cleanupError] })
  await reconnecting
  expect(native.computerReconnect).toHaveBeenCalledOnce()
  expect(settings.update).toHaveBeenLastCalledWith({ "computer.enabled": true })
})

test("successful rollback preserves the exact original public rejection", async () => {
  const error = new Error("save failed")
  settings.update.mockRejectedValueOnce(error)
  await expect(enableComputer()).rejects.toBe(error)
  expect(native.computerStop).toHaveBeenCalledOnce()
})
