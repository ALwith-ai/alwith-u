import { expect, test } from "bun:test"
import { ResourceScope } from "@alwith/module-extension/host"
import { createPluginEvents } from "../events"

test("isolates plugin events by extension and releases listeners on unload", async () => {
  const listeners = new Map<string, Set<(payload: unknown) => void>>()
  const transport = {
    async listen(event: string, callback: (payload: unknown) => void): Promise<() => void> {
      const callbacks = listeners.get(event) ?? new Set()
      callbacks.add(callback)
      listeners.set(event, callbacks)
      return () => {
        callbacks.delete(callback)
      }
    },
    async emit(event: string, payload: unknown): Promise<void> {
      for (const callback of listeners.get(event) ?? []) callback(payload)
    }
  }
  const first = new ResourceScope()
  const second = new ResourceScope()
  const events = createPluginEvents("first", first, transport)
  const other = createPluginEvents("second", second, transport)
  const received: unknown[] = []
  await events.listen("consent-decided", value => {
    received.push(value)
  })
  await other.emit("consent-decided", "other")
  expect(received).toEqual([])
  await events.emit("consent-decided", "own")
  expect(received).toEqual(["own"])
  await first.dispose()
  expect([...listeners.values()].every(callbacks => callbacks.size === 0)).toBe(true)
  await expect(events.emit("consent-decided", "late")).rejects.toThrow()
  await second.dispose()
})

test("releases an event subscription that completes after disposal", async () => {
  const scope = new ResourceScope()
  const subscription = Promise.withResolvers<() => void>()
  let removed = false
  const events = createPluginEvents("first", scope, {
    listen: async () => subscription.promise,
    emit: async () => {}
  })
  const pending = events.listen("event", () => {})
  await scope.dispose()
  subscription.resolve(() => {
    removed = true
  })
  await expect(pending).rejects.toThrow()
  expect(removed).toBe(true)
})
