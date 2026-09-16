// The official install flow: an interstitial ("Install {name}": developer, category, About,
// Capabilities, Includes) when the catalog asks for one, then, if the installed plugin has
// apps that still need auth, "Connect your apps to {name}" with a Connect link per app.
import { ExternalLinkIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import type { AppSummary, PluginDetail } from "@/agent/codex-extensions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { openExternal } from "@/lib/open"
import { pluginsStore } from "./instance"
import { PluginIcon } from "./plugin-icon"
import { type PluginEntry, pluginTitle } from "./store"

export function InstallInterstitial({
  entry,
  onClose,
  onInstalled
}: {
  entry: PluginEntry
  onClose: () => void
  onInstalled: (apps: AppSummary[]) => void
}) {
  const { t } = useTranslation()
  const [detail, setDetail] = useState<PluginDetail | null>(null)
  const [installing, setInstalling] = useState(false)
  const { plugin } = entry
  const ui = plugin.interface

  useEffect(() => {
    let alive = true
    pluginsStore
      .getState()
      .readPlugin(entry)
      .then(result => {
        if (alive) setDetail(result)
      })
      .catch(() => {
        // The interstitial still lets you install; the includes list just stays empty.
        if (alive) setDetail(null)
      })
    return () => {
      alive = false
    }
  }, [entry])

  const install = async () => {
    setInstalling(true)
    try {
      const response = await pluginsStore.getState().install(entry)
      onInstalled(response.appsNeedingAuth)
    } catch {
      setInstalling(false)
    }
  }

  const includes = detail
    ? [
        { key: "skills", label: t("plugins.installModal.includesSkills"), names: detail.skills.map(s => s.interface?.displayName ?? s.name) },
        { key: "apps", label: t("plugins.installModal.includesApps"), names: detail.apps.map(a => a.name) },
        { key: "mcp", label: t("plugins.installModal.includesMcpServers"), names: detail.mcpServers }
      ].filter(group => group.names.length > 0)
    : []

  return (
    <Dialog open onOpenChange={open => !open && !installing && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <PluginIcon plugin={plugin} size="lg" />
            <div className="min-w-0">
              <DialogTitle>{t("plugins.installModal.title", { pluginName: pluginTitle(plugin) })}</DialogTitle>
              <DialogDescription className="flex flex-wrap gap-x-3">
                {ui?.developerName && <span>{t("plugins.installModal.developedBy", { developerName: ui.developerName })}</span>}
                {ui?.category && <span>{t("plugins.installModal.category", { category: ui.category })}</span>}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="flex max-h-[50vh] flex-col gap-4 overflow-y-auto text-sm">
          {(ui?.longDescription || ui?.shortDescription) && (
            <section className="flex flex-col gap-1">
              <h3 className="text-muted-foreground text-xs font-medium">{t("plugins.installModal.about")}</h3>
              <p className="whitespace-pre-wrap">{ui?.longDescription ?? ui?.shortDescription}</p>
            </section>
          )}
          {ui && ui.capabilities.length > 0 && (
            <section className="flex flex-col gap-1">
              <h3 className="text-muted-foreground text-xs font-medium">{t("plugins.installModal.capabilities")}</h3>
              <div className="flex flex-wrap gap-1">
                {ui.capabilities.map(capability => (
                  <Badge key={capability} variant="secondary">
                    {capability}
                  </Badge>
                ))}
              </div>
            </section>
          )}
          <section className="flex flex-col gap-1">
            <h3 className="text-muted-foreground text-xs font-medium">{t("plugins.installModal.includes")}</h3>
            {detail === null ? (
              <Skeleton className="h-4 w-48" />
            ) : includes.length === 0 ? (
              <p className="text-muted-foreground">—</p>
            ) : (
              includes.map(group => (
                <p key={group.key}>
                  <span className="font-medium">{group.label}: </span>
                  {group.names.join(", ")}
                </p>
              ))
            )}
          </section>
        </div>
        <DialogFooter>
          <Button disabled={installing} onClick={() => void install()}>
            {installing && <Spinner data-icon="inline-start" />}
            {t(installing ? "plugins.installModal.installing" : "plugins.installModal.install", {
              pluginName: pluginTitle(plugin)
            })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function NeedsAppsDialog({
  entry,
  apps,
  onClose,
  onViewDetails
}: {
  entry: PluginEntry
  apps: AppSummary[]
  onClose: () => void
  onViewDetails: () => void
}) {
  const { t } = useTranslation()
  const [opened, setOpened] = useState<Record<string, true>>({})
  const name = pluginTitle(entry.plugin)
  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("plugins.installModal.needsAppsTitle", { pluginName: name })}</DialogTitle>
          <DialogDescription>{t("plugins.installModal.needsAppsSubtitle")}</DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-2">
          {apps.map(app => (
            <li key={app.id} className="flex items-center gap-3 rounded-lg border p-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{app.name}</div>
                {app.description && <div className="text-muted-foreground truncate text-xs">{app.description}</div>}
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={app.installUrl === null}
                onClick={() => {
                  if (app.installUrl === null) return
                  setOpened(current => ({ ...current, [app.id]: true }))
                  void openExternal(app.installUrl)
                }}>
                {opened[app.id] ? t("plugins.installModal.connecting") : t("plugins.installModal.connect")}
                {!opened[app.id] && <ExternalLinkIcon data-icon="inline-end" />}
              </Button>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={onViewDetails}>
            {t("plugins.installModal.viewDetails")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
