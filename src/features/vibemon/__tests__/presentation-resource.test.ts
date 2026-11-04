import type { CachedVibemonResource, VibemonAssets } from "@alwith/module-auth/vibemon"
import { expect, test, vi } from "vitest"

import { prepareVibemonResource, vibemonResourceIdentity } from "../presentation-resource"

const resource: CachedVibemonResource = {
  directory: "vibemon/catalog/dev/pets",
  format: 1,
  version: 1,
  sourceUrl: "https://example.com/resource.zip",
  archiveSha256: "first",
  sheetName: "animation/sheet.webp",
  sheet: new Uint8Array([1]),
  layout: null
}

test("a validated cached vibemon can present without waiting for the update request", async () => {
  const ensureResource = vi.fn(() => new Promise<CachedVibemonResource>(() => {}))
  const assets = { resources: { cached: () => Promise.resolve(resource) }, ensureResource } as unknown as VibemonAssets
  expect(await prepareVibemonResource(assets, "vibemon")).toEqual({ resource, needsRefresh: true })
  expect(ensureResource).not.toHaveBeenCalled()
})

test("missing or invalid local bytes must download before presentation", async () => {
  const ensureResource = vi.fn(() => Promise.resolve(resource))
  const assets = { resources: { cached: () => Promise.resolve(null) }, ensureResource } as unknown as VibemonAssets
  expect(await prepareVibemonResource(assets, "vibemon")).toEqual({ resource, needsRefresh: false })
  expect(ensureResource).toHaveBeenCalledWith("vibemon")
})

test("a failed download cannot report a missing vibemon as ready", async () => {
  const failure = new Error("Download timed out")
  const assets = {
    resources: { cached: () => Promise.resolve(null) },
    ensureResource: () => Promise.reject(failure)
  } as unknown as VibemonAssets
  await expect(prepareVibemonResource(assets, "vibemon")).rejects.toBe(failure)
})

test("unchanged animation bytes retain their presentation identity", () => {
  expect(vibemonResourceIdentity({ ...resource, sheet: new Uint8Array([1]) })).toBe(vibemonResourceIdentity(resource))
  expect(vibemonResourceIdentity({ ...resource, archiveSha256: "updated" })).not.toBe(vibemonResourceIdentity(resource))
  expect(vibemonResourceIdentity({ ...resource, version: 2 })).not.toBe(vibemonResourceIdentity(resource))
})
