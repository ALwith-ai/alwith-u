import { expect, test, vi } from "vitest"

import { RequestCache } from "../request-cache"

test("invalidated in-flight reads cannot repopulate or replace a newer cache entry", async () => {
  const cache = new RequestCache<string>("test")
  const old = Promise.withResolvers<string>()
  const first = cache.read("a", () => old.promise)
  cache.clear()
  await cache.read("a", () => Promise.resolve("new"))
  old.resolve("old")
  await first
  expect(cache.peek("a")).toBe("new")
})

test("failed reads are retryable and duplicate pending reads do not launch another request", async () => {
  const cache = new RequestCache<string>("test")
  const pending = Promise.withResolvers<string>()
  const load = vi.fn(() => pending.promise)
  const first = cache.read("a", load)
  expect(cache.read("a", load)).toBe(first)
  pending.reject(new Error("Offline"))
  await expect(first).rejects.toThrow("Offline")
  expect(load).toHaveBeenCalledOnce()
  expect(await cache.read("a", () => Promise.resolve("recovered"))).toBe("recovered")
})
