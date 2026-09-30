/// <reference types="vite/client" />
import type { ReactNode } from "react"
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
      // biome-ignore lint/security/noDangerouslySetInnerHtml: Static repository SVG, never plugin or user content.
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

export function PluginIcon({ name }: { name: string }): ReactNode {
  return (
    <svg aria-hidden="true" focusable="false" width={36} height={36} viewBox="0 0 36 36" className="size-9 shrink-0">
      <use href={pluginIconSrc(name)} />
    </svg>
  )
}
