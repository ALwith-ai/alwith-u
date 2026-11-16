import { expect, test, vi } from "vitest"

import { observeWindowMinimized } from "../window-minimized"

test("native completion events update minimization without focus or resize", async () => {
  let event!: (value: { payload: boolean }) => void
  const stop = vi.fn()
  const change = vi.fn(async (_value: boolean) => {})
  const window = {
    listen: vi.fn(async (_name: string, handler: typeof event) => {
      event = handler
      return stop
    }),
    isMinimized: vi.fn(async () => false)
  }
  const observer = await observeWindowMinimized(window, change, vi.fn())
  expect(window.listen).toHaveBeenCalledWith("alwith:window-minimized", expect.any(Function))
  event({ payload: true })
  event({ payload: false })
  expect(change.mock.calls.map(([value]) => value)).toEqual([false, true, false])
  observer.dispose()
  expect(stop).toHaveBeenCalledOnce()
})

test("a delayed snapshot cannot replace a newer minimization event", async () => {
  let event!: (value: { payload: boolean }) => void
  let complete!: (value: boolean) => void
  const change = vi.fn(async (_value: boolean) => {})
  const ready = observeWindowMinimized(
    {
      listen: async (_name, handler) => {
        event = handler
        return () => {}
      },
      isMinimized: () =>
        new Promise((resolve) => {
          complete = resolve
        })
    },
    change,
    vi.fn()
  )
  await vi.waitFor(() => expect(complete).toBeDefined())
  event({ payload: true })
  complete(false)
  await ready
  expect(change).toHaveBeenCalledExactlyOnceWith(true)
})

test("snapshot failure removes the listener", async () => {
  const stop = vi.fn()
  await expect(
    observeWindowMinimized(
      {
        listen: async () => stop,
        isMinimized: async () => {
          throw new Error("closed")
        }
      },
      vi.fn(),
      vi.fn()
    )
  ).rejects.toThrow("closed")
  expect(stop).toHaveBeenCalledOnce()
})

test("an older action snapshot cannot overwrite a newer refresh", async () => {
  const snapshots: Array<(value: boolean) => void> = []
  const change = vi.fn(async (_value: boolean) => {})
  const read = vi.fn(async () => false).mockImplementationOnce(async () => false)
  const observer = await observeWindowMinimized({ listen: async () => () => {}, isMinimized: read }, change, vi.fn())
  read.mockImplementation(() => new Promise((resolve) => snapshots.push(resolve)))
  const old = observer.refresh()
  const current = observer.refresh()
  snapshots[1](true)
  await current
  snapshots[0](false)
  await old
  expect(change.mock.calls.map(([value]) => value)).toEqual([false, true])
})
