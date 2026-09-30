import { expect, test } from "bun:test"
import { createSurfaceOperation } from "../surface-operation"

test("handoffs lock synchronously, reject overlap and unlock on failure", async () => {
  const changes: boolean[] = []
  const operation = createSurfaceOperation(value => changes.push(value))
  let finish!: () => void
  const pending = operation.run(
    () =>
      new Promise<void>(resolve => {
        finish = resolve
      })
  )
  expect(operation.busy).toBe(true)
  let called = false
  await expect(
    operation.run(async () => {
      called = true
    })
  ).rejects.toThrow("already in progress")
  expect(called).toBe(false)
  finish()
  await pending
  await expect(
    operation.run(async () => {
      throw new Error("delivery failed")
    })
  ).rejects.toThrow("delivery failed")
  expect(operation.busy).toBe(false)
  expect(changes).toEqual([true, false, true, false])
})
