import { deviceBridge } from "@alwith/module-device/tauri"
import { emit } from "@tauri-apps/api/event"
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks"
import { afterEach, expect, test, vi } from "vitest"

afterEach(() => {
  clearMocks()
  Reflect.deleteProperty(globalThis, "isTauri")
})

test("a late initial snapshot and older events cannot resurrect stale attachments", async () => {
  Object.assign(globalThis, { isTauri: true })
  let resolve!: (entries: unknown[]) => void
  const native = vi.fn(
    () =>
      new Promise<unknown[]>((done) => {
        resolve = done
      })
  )
  mockIPC(native, { shouldMockEvents: true })
  const receive = vi.fn()
  const stop = deviceBridge("a").subscribe(receive)
  await vi.waitFor(() => expect(native).toHaveBeenCalled())
  const own = { udid: "new", owner: { type: "development_session", id: "a" } }
  const other = { udid: "other", owner: { type: "development_session", id: "b" } }
  await emit("device:attachments", { revision: 2, attachments: [own, other] })
  expect(receive).toHaveBeenLastCalledWith([own])
  resolve([{ udid: "stale", owner: { type: "development_session", id: "a" } }])
  await Promise.resolve()
  await emit("device:attachments", { revision: 1, attachments: [] })
  expect(receive).toHaveBeenCalledTimes(1)
  stop()
  await emit("device:attachments", { revision: 3, attachments: [] })
  expect(receive).toHaveBeenCalledTimes(1)
})

test("subscription failures are surfaced to the pane", async () => {
  Object.assign(globalThis, { isTauri: true })
  const failure = new Error("Device service unavailable")
  mockIPC(() => Promise.reject(failure))
  const error = vi.fn()
  const stop = deviceBridge("a").subscribe(vi.fn(), error)
  await vi.waitFor(() => expect(error).toHaveBeenCalledWith(failure))
  stop()
})
