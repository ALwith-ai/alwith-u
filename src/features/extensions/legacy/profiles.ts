import type { ContributionIcon } from "@alwith/module-extension"

import profiles from "./profiles.json"

export const LEGACY_SOURCE = "legacy:alwith-u"

interface LegacyProfile {
  id: string
  icon: string
  entryIcon: ContributionIcon
  url?: string
  dataFiles: string[]
  requiredSkills: string[]
  exportFilePattern: string | null
  limitations: string[]
  unsupportedCommands: Partial<Record<string, string>>
}

const adapters: readonly LegacyProfile[] = profiles as LegacyProfile[]

export function findLegacyProfile(id: string): LegacyProfile | undefined {
  return adapters.find((item) => item.id === id)
}
