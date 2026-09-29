import type { ReactNode } from "react"

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
  return `/plugin-icons/${ICON_NAMES[hash % ICON_NAMES.length]}.svg`
}

export function PluginIcon({ name }: { name: string }): ReactNode {
  return <img src={pluginIconSrc(name)} alt="" width={36} height={36} className="size-9 shrink-0" />
}
