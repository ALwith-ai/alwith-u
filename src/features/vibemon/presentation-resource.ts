import type { CachedVibemonResource, VibemonAssets } from "@alwith/module-auth/vibemon"

export function vibemonResourceIdentity(resource: CachedVibemonResource): string {
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
export async function prepareVibemonResource(assets: VibemonAssets, vibemonId: string) {
  const cached = await assets.resources.cached(vibemonId)
  return { resource: cached ?? (await assets.ensureResource(vibemonId)), needsRefresh: cached !== null }
}
