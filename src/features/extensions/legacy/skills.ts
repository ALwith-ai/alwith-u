const BUSINESS_SKILLS = ["bi-add-metric", "bi-monthly-report", "yup-kb", "etms-strategy-review"]

export function requiredLegacySkills(text: string): string[] {
  return BUSINESS_SKILLS.filter(name => text.includes(`${name} skill`))
}

/** Presence is a prerequisite; business skills must separately adopt U's data contract. */
export function assertLegacySkills(
  required: string[],
  skills: readonly { name: string; enabled: boolean; path: string }[]
): void {
  const missing = required.filter(
    name =>
      !skills.some(
        skill => skill.name === name && skill.enabled && !skill.path.replaceAll("\\", "/").includes("/.alwith/skills/")
      )
  )
  if (missing.length)
    throw new Error(
      `缺少已启用的 Codex 业务技能：${missing.join("、")}。请通过插件/技能目录安装适用于 alwith-u 的版本；Desktop 原版技能的数据路径不兼容。`
    )
}
