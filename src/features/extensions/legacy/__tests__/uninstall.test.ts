import { expect, test } from "bun:test"
import { waitForLegacyUninstall } from "../uninstall"

test("waits for all windows before cleaning grants and import certificates", async () => {
  let state = { installed: true, pending: true }
  const listeners = new Set<() => void>()
  let cleaned = false
  const result = waitForLegacyUninstall({
    state: () => state,
    subscribe: listener => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    cleanup: async () => {
      cleaned = true
    }
  })
  await Promise.resolve()
  expect(cleaned).toBe(false)
  state = { installed: false, pending: false }
  for (const listener of listeners) listener()
  await result
  expect(cleaned).toBe(true)
  expect(listeners.size).toBe(0)
})

test("an aborted uninstall preserves grants and reports failure", async () => {
  let cleaned = false
  await expect(
    waitForLegacyUninstall({
      state: () => ({ installed: true, pending: false }),
      subscribe: () => () => {},
      cleanup: async () => {
        cleaned = true
      }
    })
  ).rejects.toThrow("卸载")
  expect(cleaned).toBe(false)
})
