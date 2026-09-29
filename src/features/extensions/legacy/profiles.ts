import profiles from "./profiles.json"

export const LEGACY_SOURCE = "legacy:alwith-u"

export function legacyProfile(id: string): (typeof profiles)[number] {
  const profile = profiles.find(item => item.id === id)
  if (!profile) throw new Error(`不支持导入此旧版扩展：${id}`)
  return profile
}
