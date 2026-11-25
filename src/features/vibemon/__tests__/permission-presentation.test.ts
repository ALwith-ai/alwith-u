import type { VibemonObservation } from "@alwith/module-auth/vibemon/core"
import { expect, test, vi } from "vitest"

import { createVibemonPermissionPresentation } from "../permission-presentation"

function permission(surfaceVisible = false): VibemonObservation {
  return { taskFeed: { tasks: [{ surfaceVisible, prompt: { kind: "permission" } }] } } as VibemonObservation
}

test("only an unresolved permission outside a visible chat requests the pet", async () => {
  let current: VibemonObservation | null = null
  const needsPet = vi.fn(async () => true)
  const present = vi.fn(async () => {})
  const show = createVibemonPermissionPresentation({
    snapshot: () => current,
    serialize: (work) => work(),
    needsPet,
    present,
    report: vi.fn()
  })
  show()
  current = permission(true)
  show()
  expect(needsPet).not.toHaveBeenCalled()
  current = permission()
  show()
  await vi.waitFor(() => expect(present).toHaveBeenCalledTimes(1))
})

test("queued observations coalesce and a visible pet is not presented again", async () => {
  const pending = Promise.withResolvers<boolean>()
  const needsPet = vi.fn(() => pending.promise)
  const present = vi.fn(async () => {})
  const show = createVibemonPermissionPresentation({
    snapshot: () => permission(),
    serialize: (work) => work(),
    needsPet,
    present,
    report: vi.fn()
  })
  show()
  show()
  expect(needsPet).toHaveBeenCalledTimes(1)
  pending.resolve(false)
  await pending.promise
  await Promise.resolve()
  expect(present).not.toHaveBeenCalled()
})

test.each([null, permission(true)])(
  "a permission resolved or revealed during the native visibility check stays hidden",
  async (next) => {
    let current: VibemonObservation | null = permission()
    const pending = Promise.withResolvers<boolean>()
    const present = vi.fn(async () => {})
    const show = createVibemonPermissionPresentation({
      snapshot: () => current,
      serialize: (work) => work(),
      needsPet: () => pending.promise,
      present,
      report: vi.fn()
    })
    show()
    current = next
    pending.resolve(true)
    await pending.promise
    await Promise.resolve()
    expect(present).not.toHaveBeenCalled()
  }
)

test("presentation errors are reported and release the queued request for retry", async () => {
  const error = new Error("Native window unavailable")
  const present = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(undefined)
  const report = vi.fn()
  const show = createVibemonPermissionPresentation({
    snapshot: () => permission(),
    serialize: (work) => work(),
    needsPet: async () => true,
    present,
    report
  })
  show()
  await vi.waitFor(() => expect(report).toHaveBeenCalledWith(error))
  show()
  await vi.waitFor(() => expect(present).toHaveBeenCalledTimes(2))
})
