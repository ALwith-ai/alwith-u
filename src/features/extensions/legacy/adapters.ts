import { findLegacyProfile } from "./profiles"

/** Business restrictions are optional host policies, never generic admission checks. */
export function validateLegacyExport(id: string, path: string): void {
  const pattern = findLegacyProfile(id)?.exportFilePattern
  if (pattern && !new RegExp(pattern).test(path)) throw new Error(`无效的 ${id} 导出文件名（ETMS 分析文件）`)
}

export function unsupportedLegacyCommand(id: string, command: string): string | undefined {
  return findLegacyProfile(id)?.unsupportedCommands[command]
}

export function legacyMessageSkills(id: string, text: string): string[] {
  return (findLegacyProfile(id)?.requiredSkills ?? []).filter(name => text.includes(`${name} skill`))
}
