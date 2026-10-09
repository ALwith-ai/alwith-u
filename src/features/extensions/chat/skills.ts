interface CatalogSkill {
  name: string
  enabled: boolean
  path: string
}

export type RequiredSkillState =
  | { name: string; status: "missing" | "disabled" | "ambiguous" }
  | { name: string; status: "enabled"; resolvedName: string }

/** The same file can appear in multiple project catalogs. Disabled copies do not shadow enabled skills. */
export function inspectRequiredSkills(
  required: readonly string[],
  skills: readonly CatalogSkill[]
): RequiredSkillState[] {
  const unique = [...new Map(skills.map(skill => [skill.path.replaceAll("\\", "/"), skill])).values()]
  return required.map(name => {
    const matching = unique.filter(
      skill =>
        (skill.name === name || skill.name.endsWith(`:${name}`)) &&
        !skill.path.replaceAll("\\", "/").includes("/.alwith/skills/")
    )
    const enabled = matching.filter(skill => skill.enabled)
    if (enabled.length > 1) return { name, status: "ambiguous" }
    if (enabled.length === 1) return { name, status: "enabled", resolvedName: enabled[0].name }
    return { name, status: matching.length ? "disabled" : "missing" }
  })
}

/** Presence is a prerequisite; business skills must separately adopt U's data contract. */
export function assertAvailableSkills(required: string[], skills: readonly CatalogSkill[]): string[] {
  return inspectRequiredSkills(required, skills).map(skill => {
    const { name, status } = skill
    if (status === "missing" || status === "disabled")
      throw new Error(
        `此操作依赖尚未就绪的 Codex 业务技能：${name}。请在技能与插件页面安装或启用 Codex 兼容版本，再打开新会话重试。`
      )
    if (status === "ambiguous") throw new Error(`发现多个可用的 ${name} 技能，请在技能与插件页面仅启用一个版本后重试`)
    if (skill.status !== "enabled") throw new Error("Invalid skill resolution")
    return skill.resolvedName
  })
}
