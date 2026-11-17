import { createVibemonAssets, createVibemonClient, type VibemonAssetsHost } from "@alwith/module-auth/vibemon"
import { afterEach, expect, test, vi } from "vitest"

const account = { apiHost: "test.example", userId: "one", revision: 0 }
afterEach(() => vi.restoreAllMocks())

test("concurrent entries share reads and a successful draw invalidates only transaction data", async () => {
  const request = vi.fn(async (path: string) => (path.endsWith("/draw") ? { results: [] } : []))
  const client = createVibemonClient({ account: () => account, request: request as VibemonAssetsHost["request"] })
  await Promise.all([client.getMyVibemons(), client.getMyVibemons(), client.getMyVibemons()])
  expect(request).toHaveBeenCalledTimes(1)
  await client.getPointAccount()
  await client.getGachaPoolDetail("one")
  await client.getGachaPoolDetail("two")
  await client.getActiveGachaPools()
  const before = request.mock.calls.length
  await client.drawGachaPool("one", "SINGLE")
  await Promise.all([
    client.getMyVibemons(),
    client.getPointAccount(),
    client.getGachaPoolDetail("one"),
    client.getGachaPoolDetail("two"),
    client.getActiveGachaPools()
  ])
  expect(request.mock.calls.length - before).toBe(4)
  expect(request.mock.calls.filter(([path]) => path.endsWith("/two"))).toHaveLength(1)
  expect(request.mock.calls.filter(([path]) => path.endsWith("/pools"))).toHaveLength(1)
})

test("expired reads refresh once and rejected reads can retry", async () => {
  let now = 1000
  vi.spyOn(Date, "now").mockImplementation(() => now)
  const request = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ available_points: 10 })
  const client = createVibemonClient({ account: () => account, request })
  await expect(client.getPointAccount()).rejects.toThrow("offline")
  await client.getPointAccount()
  await client.getPointAccount()
  expect(request).toHaveBeenCalledTimes(2)
  now += 30_001
  await Promise.all([client.getPointAccount(), client.getPointAccount()])
  expect(request).toHaveBeenCalledTimes(3)
})

test("changing accounts cannot reuse cached responses or accept old in-flight work", async () => {
  let current = account
  let resolve!: (value: unknown) => void
  const request = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    .mockResolvedValue([])
  const client = createVibemonClient({ account: () => current, request })
  const old = client.getMyVibemons()
  const rejected = expect(old).rejects.toThrow("Vibemon account changed")
  current = { ...account, userId: "two", revision: 1 }
  await client.getMyVibemons()
  resolve([{ vibemon_uuid: "old" }])
  await rejected
  await client.getMyVibemons()
  expect(request).toHaveBeenCalledTimes(2)
})

test("inventory metadata never waits for package downloads or local resource inspection", async () => {
  const item = {
    vibemon_uuid: "pet",
    resource_package_format: 1,
    resource_version: 1,
    resource_url: "https://example.test/pet.zip"
  }
  const request = vi.fn(async () => [item])
  const io = vi.fn(() => new Promise<never>(() => {}))
  const host: VibemonAssetsHost = {
    account: () => account,
    request: request as VibemonAssetsHost["request"],
    storage: { get: async () => undefined, set: async () => {} },
    resources: { read: io, exists: io, write: io, replace: io, remove: io },
    download: io
  }
  const assets = createVibemonAssets(host)
  try {
    expect(await assets.getMyVibemons()).toEqual([item])
    expect(io).not.toHaveBeenCalled()
    await assets.getMyVibemons()
    expect(request).toHaveBeenCalledTimes(1)
  } finally {
    assets.dispose()
  }
})
