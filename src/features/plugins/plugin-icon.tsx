import type { PluginSummary } from "@alwith/module-chat/client"
import { convertFileSrc } from "@tauri-apps/api/core"
import { type ReactNode, useState } from "react"

import { useTheme } from "@/components/theme-provider"

import sprite from "./plugin-icons.svg?raw"

/** Mount once outside the tab panels: WebKit loses gradients through external SVG use. */
export function PluginIconDefinitions(): ReactNode {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={0}
      height={0}
      className="pointer-events-none absolute"
      dangerouslySetInnerHTML={{ __html: sprite }}
    />
  )
}

// Keep this ordered pool stable: changing its membership remaps existing plugin names.
const ICON_NAMES = [
  "agent-mode",
  "application-window",
  "audiowave",
  "bar-chart",
  "block-stack-skills",
  "book-open",
  "briefcase",
  "bubble-on-bubble",
  "checkmark-circle",
  "code",
  "compass",
  "components-window",
  "credit-card",
  "csv",
  "document",
  "docx",
  "exclamationmark-bubble",
  "figma-document",
  "figure-text-document",
  "file-video",
  "flash",
  "folder",
  "game-controller",
  "globe",
  "heart",
  "heart-bubble",
  "heart-text-clipboard",
  "hierarchy",
  "jpg-document",
  "kettlebell",
  "ladybug",
  "lightbulb",
  "lightning-bolt",
  "magnifingglass",
  "map",
  "mappin",
  "microphone",
  "ms-word-document",
  "newspaper",
  "paperclip",
  "pdf-document",
  "pencil",
  "phone",
  "photo",
  "png-document",
  "pointer",
  "ppt-document",
  "pptx",
  "puzzle",
  "radar",
  "shield",
  "shopping-bag",
  "skill-creator",
  "skill-installer",
  "star-app",
  "star-bookmark",
  "template-creator",
  "terminal",
  "text-bubble-figure",
  "text-document",
  "text-document-lock",
  "text-note-pointer",
  "triangle-vercel",
  "xls-document-excel",
  "xlsx"
] as const

/** Desktop's deterministic name hash, backed by the local Figma icon collection. */
export function pluginIconSrc(name: string): string {
  let hash = 0
  for (const character of name) hash = (hash * 31 + character.charCodeAt(0)) % 997
  return `#plugin-${ICON_NAMES[hash % ICON_NAMES.length]}`
}

export function PluginIcon({
  name,
  info,
  className = "size-6 shrink-0"
}: {
  name: string
  info?: PluginSummary["interface"]
  className?: string
}): ReactNode {
  const { resolvedTheme } = useTheme()
  const remote =
    resolvedTheme === "dark"
      ? (info?.logoUrlDark ?? info?.logoUrl ?? info?.composerIconUrl)
      : (info?.logoUrl ?? info?.composerIconUrl ?? info?.logoUrlDark)
  const local =
    resolvedTheme === "dark"
      ? (info?.logoDark ?? info?.logo ?? info?.composerIcon)
      : (info?.logo ?? info?.composerIcon ?? info?.logoDark)
  const source = remote ?? (local ? convertFileSrc(local) : null)
  const fallback = (
    <svg aria-hidden="true" focusable="false" width={36} height={36} viewBox="0 0 36 36" className={className}>
      <use href={pluginIconSrc(name)} />
    </svg>
  )
  return source ? <PluginImage key={source} source={source} className={className} fallback={fallback} /> : fallback
}

function PluginImage({ source, className, fallback }: { source: string; className: string; fallback: ReactNode }) {
  const [failed, setFailed] = useState(false)
  if (failed) return fallback
  return (
    <img
      src={source}
      alt=""
      aria-hidden="true"
      width={36}
      height={36}
      className={`object-contain ${className}`}
      onError={() => setFailed(true)}
    />
  )
}
