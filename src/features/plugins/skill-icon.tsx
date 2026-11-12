import type { ReactNode } from "react"

import alwithDocs from "./icons/alwith-docs.svg"
import defaultIcon from "./icons/default.svg"
import imagegen from "./icons/imagegen.svg"
import openaiDocs from "./icons/openai-docs.svg"
import reviewAgent from "./icons/review-agent.svg"
import skillCreator from "./icons/skill-creator.svg"
import skillInstaller from "./icons/skill-installer.svg"

// Match canonical skill names only; display names and plugin namespaces are not aliases.
const SKILL_ICONS = new Map([
  ["openai-docs", openaiDocs],
  ["imagegen", imagegen],
  ["alwith-docs", alwithDocs],
  ["skill-creator", skillCreator],
  ["skill-installer", skillInstaller],
  ["review-agent", reviewAgent]
])

export function skillIconSrc(name: string): string {
  return SKILL_ICONS.get(name) ?? defaultIcon
}

export function SkillIcon({ name, className = "size-6 shrink-0" }: { name: string; className?: string }): ReactNode {
  return (
    <img
      src={skillIconSrc(name)}
      alt=""
      aria-hidden="true"
      width={36}
      height={36}
      className={`object-contain ${className}`}
    />
  )
}
