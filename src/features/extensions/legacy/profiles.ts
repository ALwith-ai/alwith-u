import profiles from "./profiles.json"

export const LEGACY_SOURCE = "legacy:alwith-u"

interface LegacyProfile {
  id: string
  icon: string
  sourceSha256: string
  url: string
  networkHosts: string[]
  dataFiles: string[]
  requiredSkills: string[]
  exportFilePattern: string | null
  limitations: string[]
  unsupportedCommands: Partial<Record<string, string>>
}

const adapters: readonly LegacyProfile[] = profiles

export function findLegacyProfile(id: string): LegacyProfile | undefined {
  return adapters.find(item => item.id === id)
}
