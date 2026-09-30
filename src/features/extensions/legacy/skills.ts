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
      `此操作依赖尚未就绪的 Codex 业务技能：${missing.join("、")}。旧技能的数据路径不兼容；当前兼容范围不包含该 AI 功能。`
    )
}
