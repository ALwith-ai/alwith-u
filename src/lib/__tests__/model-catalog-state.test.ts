import { expect, test } from "vitest"

import { CatalogAccountChangedError, createCatalogSource } from "../model-catalog-state"

test("publishes loading and a successful empty catalog as distinct states", async () => {
  const source = createCatalogSource<string[]>()
  const pending = Promise.withResolvers<string[]>()
  expect(source.getSnapshot()).toEqual({ status: "idle", data: null, error: null })

  const refresh = source.refresh(() => pending.promise)
  expect(source.getSnapshot()).toEqual({ status: "loading", data: null, error: null })
  pending.resolve([])
  await refresh

  expect(source.getSnapshot()).toEqual({ status: "ready", data: [], error: null })
})

test("retains same-account data on refresh failure and propagates the failure", async () => {
  const source = createCatalogSource<string[]>()
  await source.refresh(async () => ["saved"])
  const pending = Promise.withResolvers<string[]>()
  const refresh = source.refresh(() => pending.promise)
  expect(source.getSnapshot()).toEqual({ status: "loading", data: ["saved"], error: null })

  const failure = new Error("catalog unavailable")
  pending.reject(failure)
  await expect(refresh).rejects.toBe(failure)
  expect(source.getSnapshot()).toEqual({ status: "error", data: ["saved"], error: failure })

  await source.refresh(async () => [])
  expect(source.getSnapshot()).toEqual({ status: "ready", data: [], error: null })
})

test("represents an initial synchronous loader failure without claiming an empty catalog", async () => {
  const source = createCatalogSource<string[]>()
  const failure = new Error("request could not start")
  await expect(
    source.refresh(() => {
      throw failure
    })
  ).rejects.toBe(failure)
  expect(source.getSnapshot()).toEqual({ status: "error", data: null, error: failure })
})

test("publishes changes to independent subscriptions and releases only the requested subscription", async () => {
  const source = createCatalogSource<string[]>()
  const other = createCatalogSource<string[]>()
  const first: string[] = []
  const second: string[] = []
  const unrelated: string[] = []
  const release = source.subscribe(() => first.push(source.getSnapshot().status))
  source.subscribe(() => second.push(source.getSnapshot().status))
  other.subscribe(() => unrelated.push(other.getSnapshot().status))

  await source.refresh(async () => ["model"])
  release()
  release()
  source.update(["updated"])
  source.reset(null)

  expect(first).toEqual(["loading", "ready"])
  expect(second).toEqual(["loading", "ready", "ready", "idle"])
  expect(unrelated).toEqual([])
  expect(other.getSnapshot()).toEqual({ status: "idle", data: null, error: null })
  expect(source.getSnapshot()).toEqual({ status: "idle", data: null, error: null })
})

test("clears a previous failure when an authoritative update arrives", async () => {
  const source = createCatalogSource<string[]>()
  await expect(
    source.refresh(async () => {
      throw new Error("failed")
    })
  ).rejects.toThrow("failed")
  source.update(["pushed"])
  expect(source.getSnapshot()).toEqual({ status: "ready", data: ["pushed"], error: null })
})

test("a late read cannot replace a newer authoritative update", async () => {
  const source = createCatalogSource<string[]>()
  const pending = Promise.withResolvers<string[]>()
  const refresh = source.refresh(() => pending.promise)
  source.update(["new"])
  const authoritative = source.getSnapshot()
  pending.resolve(["old"])
  await refresh
  expect(source.getSnapshot()).toBe(authoritative)
})

test("a late failure cannot replace a newer authoritative update but still rejects", async () => {
  const source = createCatalogSource<string[]>()
  const pending = Promise.withResolvers<string[]>()
  const refresh = source.refresh(() => pending.promise)
  source.update(["new"])
  const authoritative = source.getSnapshot()
  const failure = new Error("old request failed")
  pending.reject(failure)
  await expect(refresh).rejects.toBe(failure)
  expect(source.getSnapshot()).toBe(authoritative)
})

test("overlapping refreshes publish only the newest request", async () => {
  const source = createCatalogSource<string[]>()
  const first = Promise.withResolvers<string[]>()
  const second = Promise.withResolvers<string[]>()
  const older = source.refresh(() => first.promise)
  const newer = source.refresh(() => second.promise)
  second.resolve(["second"])
  await newer
  first.resolve(["first"])
  await older
  expect(source.getSnapshot()).toEqual({ status: "ready", data: ["second"], error: null })
})

test.each(["success", "failure"] as const)(
  "account reset synchronously clears data and rejects an old %s",
  async (outcome) => {
    const source = createCatalogSource<string[]>()
    source.reset({ id: "first" })
    source.update(["private"])
    const pending = Promise.withResolvers<string[]>()
    const refresh = source.refresh(() => pending.promise)
    const rejected = expect(refresh).rejects.toBeInstanceOf(CatalogAccountChangedError)
    source.reset({ id: "second" })
    expect(source.getSnapshot()).toEqual({ status: "idle", data: null, error: null })

    source.update(["second account"])
    const current = source.getSnapshot()
    if (outcome === "success") pending.resolve(["first account"])
    else pending.reject(new Error("first account failed"))
    await rejected
    expect(source.getSnapshot()).toBe(current)
  }
)

test("logout and relogin invalidate old reads even when account identity is reused", async () => {
  const source = createCatalogSource<string[]>()
  const account = { id: "same" }
  source.reset(account)
  const pending = Promise.withResolvers<string[]>()
  const refresh = source.refresh(() => pending.promise)
  const rejected = expect(refresh).rejects.toBeInstanceOf(CatalogAccountChangedError)
  source.reset(null)
  source.reset(account)
  pending.resolve(["previous login"])
  await rejected
  expect(source.getSnapshot()).toEqual({ status: "idle", data: null, error: null })
})

test("an explicit reset invalidates old reads even for the same account object", async () => {
  const source = createCatalogSource<string[]>()
  const account = { id: "same" }
  source.reset(account)
  const pending = Promise.withResolvers<string[]>()
  const refresh = source.refresh(() => pending.promise)
  const rejected = expect(refresh).rejects.toBeInstanceOf(CatalogAccountChangedError)
  source.reset(account)
  pending.resolve(["before reset"])
  await rejected
  expect(source.getSnapshot()).toEqual({ status: "idle", data: null, error: null })
})
