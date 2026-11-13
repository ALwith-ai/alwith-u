import type { SkillMetadata } from "@alwith/module-chat/client"
import { convertFileSrc } from "@tauri-apps/api/core"
import { type ReactNode, useState } from "react"

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

export function skillIconSrc(name: string, info?: SkillMetadata["interface"] | null): string {
  return (
    info?.iconSmallUrl ??
    info?.iconLargeUrl ??
    (info?.iconSmall ? convertFileSrc(info.iconSmall) : info?.iconLarge ? convertFileSrc(info.iconLarge) : null) ??
    SKILL_ICONS.get(name) ??
    defaultIcon
  )
}

export function SkillIcon({
  name,
  info,
  className = "size-6 shrink-0"
}: {
  name: string
  info?: SkillMetadata["interface"] | null
  className?: string
}): ReactNode {
  const sources = [
    ...new Set(
      [
        info?.iconSmallUrl ?? info?.iconLargeUrl,
        info?.iconSmall ? convertFileSrc(info.iconSmall) : null,
        info?.iconLarge ? convertFileSrc(info.iconLarge) : null,
        SKILL_ICONS.get(name)
      ].filter((source): source is string => !!source)
    )
  ]
  return <SkillImage key={JSON.stringify(sources)} sources={sources} className={className} />
}

function SkillImage({ sources, className }: { sources: string[]; className: string }): ReactNode {
  const [index, setIndex] = useState(0)
  const source = sources[index] ?? defaultIcon
  return (
    <img
      src={source}
      alt=""
      aria-hidden="true"
      width={36}
      height={36}
      className={`object-contain ${className}`}
      onError={source === defaultIcon ? undefined : () => setIndex((current) => current + 1)}
    />
  )
}
