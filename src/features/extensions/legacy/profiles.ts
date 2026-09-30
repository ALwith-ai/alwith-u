import profiles from "./profiles.json"

export const LEGACY_SOURCE = "legacy:alwith-u"

interface LegacyProfile {
  id: string
  icon: string
  sourceSha256: string
  patchedSha256: string
  url: string
  patches: { before: string; after: string }[]
  networkHosts: string[]
  dataFiles: string[]
  requiredSkills: string[]
  exportFilePattern: string | null
  unsupportedCommands: Partial<Record<string, string>>
}

const adapters: readonly LegacyProfile[] = profiles

export function findLegacyProfile(id: string): LegacyProfile | undefined {
  return adapters.find(item => item.id === id)
}

export function legacyProfile(id: string): LegacyProfile {
  const profile = findLegacyProfile(id)
  if (!profile) throw new Error(`此扩展没有特定兼容规则：${id}`)
  return profile
}
