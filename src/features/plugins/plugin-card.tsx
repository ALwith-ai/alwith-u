// The plugin card of the official Codex plugins page: icon, name, "By developer", short
// description, the Install / Installing / Manage action, and the actions menu. Tooltips
// spell out why an install is blocked and which marketplace the plugin comes from.
import { MoreHorizontalIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { useStore } from "zustand"
import type { PluginSummary } from "@/agent/codex-extensions"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { pluginsStore } from "./instance"
import { PluginIcon } from "./plugin-icon"
import { type PluginEntry, isBuiltInMarketplace, isGitMarketplace, pluginDescription, pluginTitle } from "./store"

/** Why a plugin cannot be installed, in the official wording; null when it can. */
export function installBlockedReason(plugin: PluginSummary, t: (key: string) => string): string | null {
  if (plugin.availability === "DISABLED_BY_ADMIN") return t("plugins.card.disabledInstallTooltip")
  if (plugin.installPolicy === "NOT_AVAILABLE") {
    switch (plugin.disabledReason) {
      case "PLAN_NOT_ELIGIBLE":
        return t("plugins.disabledReason.planNotEligible")
      case "REQUIRED_APP_UNAVAILABLE":
        return t("plugins.disabledReason.requiredAppUnavailable")
      default:
        return t("plugins.disabledReason.unknown")
    }
  }
  return null
}

/** Where the plugin comes from, as the official card's source tooltip says. */
export function sourceTooltip(entry: PluginEntry, t: (key: string, options?: Record<string, string>) => string): string {
  const { plugin, marketplace } = entry
  const marketplaceName = marketplace.interface?.displayName ?? marketplace.name
  if (marketplace.path === null) return t("plugins.card.namedGitMarketplace", { marketplaceName })
  if (plugin.source.type === "local" && !isBuiltInMarketplace(marketplace) && !isGitMarketplace(marketplace)) {
    return t("plugins.card.namedFolderMarketplace", { marketplaceName })
  }
  if (isGitMarketplace(marketplace)) return t("plugins.card.namedGitMarketplace", { marketplaceName })
  return t("plugins.card.localPlugin")
}

export function PluginActionButton({
  entry,
  installed,
  onInstall,
  onManage,
  size = "sm"
}: {
  entry: PluginEntry
  installed: boolean
  onInstall: () => void
  onManage?: () => void
  size?: "sm" | "default"
}) {
  const { t } = useTranslation()
  const busy = useStore(pluginsStore, state => state.busyIds[entry.plugin.id])
  const { plugin } = entry
  if (busy) {
    return (
      <Button size={size} variant="outline" disabled>
        <Spinner data-icon="inline-start" />
        {t(busy === "installing" ? "plugins.card.installing" : "plugins.card.uninstalling")}
      </Button>
    )
  }
  if (plugin.installPolicy === "INSTALLED_BY_DEFAULT") {
    return (
      <Button size={size} variant="outline" disabled>
        {t("plugins.card.installedByAdmin")}
      </Button>
    )
  }
  if (installed) {
    return (
      <Button size={size} variant="outline" onClick={onManage}>
        {t("plugins.card.manage")}
      </Button>
    )
  }
  const blocked = installBlockedReason(plugin, t)
  if (blocked !== null) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="inline-flex">
              <Button size={size} variant="outline" disabled>
                {plugin.availability === "DISABLED_BY_ADMIN" ? t("plugins.card.disabledByAdmin") : t("plugins.card.install")}
              </Button>
            </span>
          }
        />
        <TooltipContent>{blocked}</TooltipContent>
      </Tooltip>
    )
  }
  return (
    <Button size={size} variant="outline" aria-label={t("plugins.card.installTooltip")} onClick={onInstall}>
      {t("plugins.card.install")}
    </Button>
  )
}

export function PluginCard({
  entry,
  installed,
  onOpen,
  onInstall,
  onManage,
  onUninstall
}: {
  entry: PluginEntry
  installed: boolean
  onOpen: () => void
  onInstall: () => void
  onManage?: () => void
  onUninstall?: () => void
}) {
  const { t } = useTranslation()
  const { plugin } = entry
  const description = pluginDescription(plugin)
  const developer = plugin.interface?.developerName
  const busy = useStore(pluginsStore, state => state.busyIds[plugin.id])
  return (
    <div
      className={cn(
        "group/plugin bg-card hover:bg-accent/40 flex items-start gap-3 rounded-xl border p-3 text-start transition-colors"
      )}>
      <button type="button" className="flex min-w-0 flex-1 items-start gap-3 text-start" onClick={onOpen}>
        <Tooltip>
          <TooltipTrigger render={<PluginIcon plugin={plugin} />} />
          <TooltipContent>{sourceTooltip(entry, t)}</TooltipContent>
        </Tooltip>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{pluginTitle(plugin)}</div>
          {developer && (
            <div className="text-muted-foreground truncate text-xs">
              {t("plugins.installModal.developedBy", { developerName: developer })}
            </div>
          )}
          {description && (
            <p className="text-muted-foreground mt-1 line-clamp-2 text-xs" title={description}>
              {description}
            </p>
          )}
        </div>
      </button>
      <div className="flex shrink-0 items-center gap-1">
        <PluginActionButton entry={entry} installed={installed} onInstall={onInstall} onManage={onManage} />
        {installed && onUninstall && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label={t("plugins.card.moreActions")} />
              }>
              <MoreHorizontalIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[160px]">
              <DropdownMenuItem
                className="text-destructive"
                disabled={busy !== undefined || plugin.installPolicy === "INSTALLED_BY_DEFAULT"}
                onClick={onUninstall}>
                {t("plugins.card.uninstall")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  )
}
