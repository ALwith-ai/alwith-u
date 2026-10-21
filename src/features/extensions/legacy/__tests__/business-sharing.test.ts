import { expect, test, vi } from "vitest"

import { createBusinessSharing } from "../business-sharing"

test("publishes saved settings, clears stale context and shares reader changes in order", async () => {
  let settings = { token: "first" }
  let changed = (): void => {}
  const writes: unknown[] = []
  const sharing = createBusinessSharing(
    {
      read: () => Promise.resolve(settings),
      write: async () => {},
      exists: () => Promise.resolve(true),
      resource: (p) => p
    },
    (file, value) => {
      return Promise.try(() => {
        writes.push([file, value])
      })
    },
    (callback) => {
      changed = callback
      return Promise.resolve(() => {})
    },
    (error) => {
      throw error
    },
    true
  )
  await sharing.flush()
  expect(writes).toContainEqual(["current", null])
  expect(writes).toContainEqual(["data", { token: "first" }])
  settings = { token: "second" }
  changed()
  await sharing.flush()
  expect(writes.at(-1)).toEqual(["data", { token: "second" }])
  await sharing.current({ fileId: 42, name: "Report" })
  expect(writes.at(-1)).toEqual(["current", { fileId: 42, name: "Report" }])
  await sharing.dispose()
  expect(writes.at(-1)).toEqual(["current", null])
  await expect(sharing.flush()).rejects.toThrow()
})

test("a failed share blocks the caller and can retry", async () => {
  const report = vi.fn()
  const publish = vi.fn().mockRejectedValueOnce(new Error("disk unavailable")).mockResolvedValue(undefined)
  const sharing = createBusinessSharing(
    {
      read: () => Promise.resolve({ token: "value" }),
      write: async () => {},
      exists: () => Promise.resolve(true),
      resource: (p) => p
    },
    publish,
    () => Promise.resolve(() => {}),
    report,
    false
  )
  await expect(sharing.flush()).rejects.toThrow("disk unavailable")
  await sharing.flush()
  expect(publish).toHaveBeenLastCalledWith("data", { token: "value" })
  await sharing.dispose()
})

test("reports background publication failure and stops listening after disposal", async () => {
  let changed = (): void => {}
  const report = vi.fn()
  const unsubscribe = vi.fn()
  let reject = false
  const writes: unknown[] = []
  const sharing = createBusinessSharing(
    {
      read: () => Promise.resolve({ token: "value" }),
      write: async () => {},
      exists: () => Promise.resolve(true),
      resource: (p) => p
    },
    (file, value) => {
      return Promise.try(() => {
        if (reject) throw new Error("unavailable")
        writes.push([file, value])
      })
    },
    (callback) => {
      changed = callback
      return Promise.resolve(unsubscribe)
    },
    report,
    false
  )
  await sharing.flush()
  reject = true
  changed()
  await expect(sharing.flush()).rejects.toThrow("unavailable")
  expect(report).toHaveBeenCalledWith(expect.objectContaining({ message: "unavailable" }))
  reject = false
  await sharing.dispose()
  changed()
  expect(unsubscribe).toHaveBeenCalledOnce()
  expect(writes).toHaveLength(1)
})

test("a failed document switch is retried before an AI request can continue", async () => {
  let fail = false
  let published: unknown
  const sharing = createBusinessSharing(
    { read: () => Promise.resolve({}), write: async () => {}, exists: () => Promise.resolve(true), resource: (p) => p },
    (file, value) => {
      return Promise.try(() => {
        if (file === "current") {
          if (fail) throw new Error("read-only disk")
          published = value
        }
      })
    },
    () => Promise.resolve(() => {}),
    () => {},
    true
  )
  await sharing.flush()
  await sharing.current({ fileId: "A" })
  fail = true
  await expect(sharing.current({ fileId: "B" })).rejects.toThrow("read-only disk")
  await expect(sharing.flush()).rejects.toThrow("read-only disk")
  fail = false
  await sharing.flush()
  expect(published).toEqual({ fileId: "B" })
  await sharing.dispose()
})
