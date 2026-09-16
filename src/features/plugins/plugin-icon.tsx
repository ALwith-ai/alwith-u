// Plugin and skill icons the way the official page resolves them: a local file from the
// installed package (served through Tauri's asset protocol) or the catalog's URL.
import { convertFileSrc } from "@tauri-apps/api/core"
import { PuzzleIcon, SparklesIcon } from "lucide-react"
import type { PluginSummary, SkillMetadata, SkillSummary } from "@/agent/codex-extensions"
import { useTheme } from "@/components/theme-provider"
import { cn } from "@/lib/utils"

function fileOrUrl(local: string | null | undefined, url: string | null | undefined): string | null {
  if (typeof local === "string" && local.length > 0) return convertFileSrc(local)
  return url ?? null
}

/** The small composer icon of a plugin. */
export function pluginIconSrc(plugin: PluginSummary): string | null {
  return fileOrUrl(plugin.interface?.composerIcon, plugin.interface?.composerIconUrl)
}

/** The plugin's logo for the detail header, dark variant when the app is dark. */
export function pluginLogoSrc(plugin: PluginSummary, dark: boolean): string | null {
  const ui = plugin.interface
  if (!ui) return null
  const darkSrc = fileOrUrl(ui.logoDark, ui.logoUrlDark)
  const lightSrc = fileOrUrl(ui.logo, ui.logoUrl)
  return (dark ? (darkSrc ?? lightSrc) : lightSrc) ?? pluginIconSrc(plugin)
}

export function skillIconSrc(skill: SkillMetadata | SkillSummary): string | null {
  return fileOrUrl(skill.interface?.iconSmall, skill.interface?.iconSmallUrl)
}

const SIZES = {
  sm: { box: "size-8 rounded-md", image: "size-6", icon: "size-4" },
  md: { box: "size-10 rounded-lg", image: "size-8", icon: "size-5" },
  lg: { box: "size-16 rounded-2xl", image: "size-12", icon: "size-7" }
} as const

export function PluginIcon({
  plugin,
  size = "md",
  className
}: {
  plugin: PluginSummary
  size?: keyof typeof SIZES
  className?: string
}) {
  const { resolvedTheme } = useTheme()
  const src = size === "lg" ? pluginLogoSrc(plugin, resolvedTheme === "dark") : pluginIconSrc(plugin)
  const sizes = SIZES[size]
  return (
    <div
      className={cn("bg-muted flex shrink-0 items-center justify-center overflow-hidden", sizes.box, className)}
      style={plugin.interface?.brandColor ? { backgroundColor: plugin.interface.brandColor } : undefined}>
      {src ? (
        <img src={src} alt="" className={cn("object-contain", sizes.image)} />
      ) : (
        <PuzzleIcon className={cn("text-muted-foreground", sizes.icon)} />
      )}
    </div>
  )
}

export function SkillIcon({
  skill,
  size = "md",
  className
}: {
  skill: SkillMetadata | SkillSummary
  size?: keyof typeof SIZES
  className?: string
}) {
  const src = skillIconSrc(skill)
  const sizes = SIZES[size]
  return (
    <div className={cn("bg-muted flex shrink-0 items-center justify-center overflow-hidden", sizes.box, className)}>
      {src ? (
        <img src={src} alt="" className={cn("object-contain", sizes.image)} />
      ) : (
        <SparklesIcon className={cn("text-muted-foreground", sizes.icon)} />
      )}
    </div>
  )
}
