import type { CachedPetResource, PetAssets } from "@alwith/module-auth/pets"

export function petResourceIdentity(resource: CachedPetResource): string {
  return JSON.stringify([
    resource.directory,
    resource.format,
    resource.version,
    resource.sourceUrl,
    resource.archiveSha256,
    resource.layout
  ])
}

/** Validate local bytes before presenting; only a cache miss blocks on the network. */
export async function preparePetResource(assets: PetAssets, petId: string) {
  const cached = await assets.resources.cached(petId)
  return { resource: cached ?? (await assets.ensureResource(petId)), needsRefresh: cached !== null }
}
