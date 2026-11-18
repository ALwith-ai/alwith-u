import { expect, test, vi } from "vitest"

import { observeWindowHidden } from "../window-hidden"

test("native events publish hidden and restored states without focus or resize", async () => {
  let event!: (value: { payload: boolean }) => void
  const stop = vi.fn()
  const change = vi.fn((_hidden: boolean) => Promise.resolve())
  const window = {
    listen: vi.fn((_name: string, handler: typeof event) => {
      event = handler
      return Promise.resolve(stop)
    })
  }
  const observer = await observeWindowHidden(window, change, vi.fn(), () => Promise.resolve(false))
  expect(window.listen).toHaveBeenCalledWith("alwith:window-hidden", expect.any(Function))
  event({ payload: true })
  event({ payload: true })
  event({ payload: false })
  expect(change.mock.calls.map(([value]) => value)).toEqual([false, true, false])
  observer.dispose()
  expect(stop).toHaveBeenCalledOnce()
})

test("a delayed snapshot cannot replace a newer native event", async () => {
  let event!: (value: { payload: boolean }) => void
  const read = Promise.withResolvers<boolean>()
  const change = vi.fn((_hidden: boolean) => Promise.resolve())
  const window = {
    listen: (_name: string, handler: typeof event) => {
      event = handler
      return Promise.resolve(() => {})
    }
  }
  const ready = observeWindowHidden(window, change, vi.fn(), () => read.promise)
  await Promise.resolve()
  event({ payload: true })
  read.resolve(false)
  await ready
  expect(change).toHaveBeenCalledExactlyOnceWith(true)
})

test("snapshot failure removes the listener", async () => {
  const stop = vi.fn()
  const window = { listen: () => Promise.resolve(stop) }
  await expect(
    observeWindowHidden(window, vi.fn(), vi.fn(), () => Promise.reject(new Error("closed")))
  ).rejects.toThrow("closed")
  expect(stop).toHaveBeenCalledOnce()
})

test("an older action snapshot cannot overwrite a newer refresh", async () => {
  const older = Promise.withResolvers<boolean>()
  const newer = Promise.withResolvers<boolean>()
  const change = vi.fn((_hidden: boolean) => Promise.resolve())
  const window = { listen: () => Promise.resolve(() => {}) }
  const read = vi.fn(() => Promise.resolve(false))
  const observer = await observeWindowHidden(window, change, vi.fn(), read)
  read.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
  const old = observer.refresh()
  const current = observer.refresh()
  newer.resolve(true)
  await current
  older.resolve(false)
  await old
  expect(change.mock.calls.map(([value]) => value)).toEqual([false, true])
})
