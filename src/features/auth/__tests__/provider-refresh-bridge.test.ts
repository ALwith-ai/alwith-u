import type { EventCallback, EventName } from "@tauri-apps/api/event"
import { afterEach, expect, test, vi } from "vitest"

import { createProviderRefreshClient, serveProviderRefresh } from "../provider-refresh-bridge"

function bus() {
  const listeners = new Map<string, Set<EventCallback<unknown>>>()
  const events = {
    listen: async <T>(event: EventName, callback: EventCallback<T>) => {
      await Promise.resolve()
      const bucket = listeners.get(event) ?? new Set<EventCallback<unknown>>()
      bucket.add(callback as EventCallback<unknown>)
      listeners.set(event, bucket)
      return () => {
        bucket.delete(callback as EventCallback<unknown>)
      }
    },
    emitTo: async (_target: unknown, event: EventName, payload?: unknown): Promise<void> => {
      for (const listener of listeners.get(event) ?? []) listener({ event, id: 0, payload })
    }
  }
  return { events, count: (): number => [...listeners.values()].reduce((count, bucket) => count + bucket.size, 0) }
}
afterEach(() => vi.useRealTimers())

test("concurrent entry requests share the actual fetch and wait for completion", async () => {
  const wire = bus()
  let finish!: () => void
  const fetching = new Promise<void>((resolve) => {
    finish = resolve
  })
  const fetch = vi.fn(() => fetching)
  const stop = await serveProviderRefresh(fetch, wire.events)
  const request = createProviderRefreshClient("settings", wire.events)
  const first = request()
  expect(request()).toBe(first)
  let completed = false
  void first.then(() => {
    completed = true
  })
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
  expect(completed).toBe(false)
  finish()
  await first
  expect(completed).toBe(true)
  expect(wire.count()).toBe(1)
  stop()
  expect(wire.count()).toBe(0)
})

test("a native fetch error reaches settings and a later request retries the fetch", async () => {
  const wire = bus()
  const fetch = vi
    .fn<() => Promise<void>>()
    .mockRejectedValueOnce({ message: "Account catalog unavailable" })
    .mockResolvedValue()
  const stop = await serveProviderRefresh(fetch, wire.events)
  const request = createProviderRefreshClient("settings", wire.events)
  await expect(request()).rejects.toThrow("Account catalog unavailable")
  await expect(request()).resolves.toBeUndefined()
  expect(fetch).toHaveBeenCalledTimes(2)
  stop()
  expect(wire.count()).toBe(0)
})

test("an absent main window times out and releases the response listener", async () => {
  vi.useFakeTimers()
  const wire = bus()
  const request = createProviderRefreshClient("settings", wire.events)
  const failed = expect(request()).rejects.toThrow("timed out")
  await vi.advanceTimersByTimeAsync(60_000)
  await failed
  expect(wire.count()).toBe(0)
})
