import type { CachedPetResource, PetAssets } from "@alwith/module-auth/pets"
import { expect, test, vi } from "vitest"

import { petResourceIdentity, preparePetResource } from "../presentation-resource"

const resource: CachedPetResource = {
  directory: "vibemon/catalog/dev/pet",
  format: 1,
  version: 1,
  sourceUrl: "https://example.com/resource.zip",
  archiveSha256: "first",
  sheetName: "animation/sheet.webp",
  sheet: new Uint8Array([1]),
  layout: null
}

test("a validated cached pet can present without waiting for the update request", async () => {
  const ensureResource = vi.fn(() => new Promise<CachedPetResource>(() => {}))
  const assets = { resources: { cached: () => Promise.resolve(resource) }, ensureResource } as unknown as PetAssets
  expect(await preparePetResource(assets, "pet")).toEqual({ resource, needsRefresh: true })
  expect(ensureResource).not.toHaveBeenCalled()
})

test("missing or invalid local bytes must download before presentation", async () => {
  const ensureResource = vi.fn(() => Promise.resolve(resource))
  const assets = { resources: { cached: () => Promise.resolve(null) }, ensureResource } as unknown as PetAssets
  expect(await preparePetResource(assets, "pet")).toEqual({ resource, needsRefresh: false })
  expect(ensureResource).toHaveBeenCalledWith("pet")
})

test("a failed download cannot report a missing pet as ready", async () => {
  const failure = new Error("Download timed out")
  const assets = {
    resources: { cached: () => Promise.resolve(null) },
    ensureResource: () => Promise.reject(failure)
  } as unknown as PetAssets
  await expect(preparePetResource(assets, "pet")).rejects.toBe(failure)
})

test("unchanged animation bytes retain their presentation identity", () => {
  expect(petResourceIdentity({ ...resource, sheet: new Uint8Array([1]) })).toBe(petResourceIdentity(resource))
  expect(petResourceIdentity({ ...resource, archiveSha256: "updated" })).not.toBe(petResourceIdentity(resource))
  expect(petResourceIdentity({ ...resource, version: 2 })).not.toBe(petResourceIdentity(resource))
})
