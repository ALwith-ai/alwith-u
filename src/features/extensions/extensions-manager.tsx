import { resolveManifestText } from "@alwith/module-extension"
import type { HostSnapshot, RuntimeSnapshot, ViewContribution } from "@alwith/module-extension/host"
import { sortContributions } from "@alwith/module-extension/host"
import type { Request } from "@alwith/module-extension/tauri"
import { CircleArrowUpIcon, MoreVerticalIcon, PlusIcon, RefreshCwIcon, Trash2Icon, XIcon } from "lucide-react"
import { type ReactNode, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { CatalogHeader } from "@/components/alwith-ui/catalog-header"
import {
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  PanelItem,
  PanelItemTitle,
  PanelList
} from "@/components/alwith-ui/panel-item"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { openExternal } from "@/lib/open"

import { ExtensionIcon } from "./extension-icon"
import { EXTENSION_ICONS } from "./extension-icons"
import { findLegacyProfile, LEGACY_SOURCE } from "./legacy/profiles"
import { extensionActions } from "./policy"

export type ExtensionInstallPhase = "preparing" | "installing"

interface ExtensionsManagerProps {
  state: RuntimeSnapshot
  host: HostSnapshot
  busy: boolean
  installPhase?: ExtensionInstallPhase | null
  onInstall: (id?: string) => void
  onRequest: (request: Request) => void
  onReload?: (id: string) => void
  onRetry?: () => void
  onUninstall: (id: string, name: string) => void
  onOpenSurface?: (id: string) => void
  renderSettings: (view: ViewContribution) => ReactNode
}

/** Desktop's extension page layout, backed exclusively by the independent extension runtime. */
export function ExtensionsManager({
  state,
  host,
  busy,
  installPhase,
  onInstall,
  onRequest,
  onUninstall,
  onReload,
  onRetry,
  onOpenSurface,
  renderSettings
}: ExtensionsManagerProps) {
  const { t, i18n } = useTranslation()
  const [query, setQuery] = useState("")
  const [dismissedNotices, setDismissedNotices] = useState<Set<string>>(() => new Set())
  const search = query.trim().toLocaleLowerCase()
  const installations = state.native?.installations ?? []
  const matches = installations
    .map((item) => ({ item, ...resolveManifestText(item.manifest, i18n.language) }))
    .filter(({ item, name, description }) =>
      [name, item.id, item.manifest.version, description, item.manifest.author]
        .join(" ")
        .toLocaleLowerCase()
        .includes(search)
    )
  const unavailable = busy || state.native === null
  return (
    <div className="@container flex min-w-0 flex-col gap-8">
      <CatalogHeader
        title={t("sidebar.extensions")}
        badge={<Badge className="bg-primary/10 text-[10px] text-primary">BETA</Badge>}
      >
        <Button variant="outline" size="sm" className="h-9" disabled={unavailable} onClick={() => onInstall()}>
          {installPhase ? <Spinner aria-hidden="true" /> : <PlusIcon />}
          {t("extensions.install")}
        </Button>
      </CatalogHeader>
      {installPhase && (
        <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner aria-hidden="true" />
          {t(installPhase === "preparing" ? "extensions.preparingInstall" : "extensions.installing")}
        </div>
      )}
      {state.errors.service && (
        <Alert variant="destructive">
          <AlertDescription>
            {state.errors.service}
            {onRetry && (
              <Button variant="outline" size="sm" className="h-9" disabled={busy} onClick={onRetry}>
                {t("actions.retry")}
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}
      <div className="space-y-4">
        <Input
          type="search"
          aria-label={t("extensions.search")}
          placeholder={t("extensions.search")}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        {state.native === null && !state.errors.service && (
          <div role="status" className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Spinner />
            {t("extensions.loading")}
          </div>
        )}
        {state.native !== null && matches.length === 0 && (
          <p className="py-12 text-center text-sm text-muted-foreground">
            {t(installations.length === 0 ? "extensions.empty" : "extensions.noMatches")}
          </p>
        )}
        <PanelList className="grid grid-cols-1 gap-x-4 gap-y-3 @2xl:grid-cols-2">
          {matches.map(({ item, name, description }) => {
            // Imported metadata has a smaller icon vocabulary than entry contributions.
            const entryAction = sortContributions(
              host.actions.filter(
                (action) =>
                  action.extensionId === item.id && (action.placement === "topBar" || action.placement === "navigation")
              )
            )[0]
            const entryIcon =
              item.source === LEGACY_SOURCE
                ? entryAction
                  ? (entryAction.icon ?? "blocks")
                  : findLegacyProfile(item.id)?.entryIcon
                : undefined
            const actions = extensionActions(item)
            const pending = state.native?.pending.find((value) => value.id === item.id)
            const error = state.errors[item.id]
            const blocked = unavailable || Boolean(pending)
            const surfaces = onOpenSurface
              ? sortContributions(host.views.filter((view) => view.extensionId === item.id && view.kind === "surfaces"))
              : []
            return (
              <section key={item.installationId} aria-label={name} className="min-w-0">
                <PanelItem className="group/extension items-center gap-3 rounded-md border-0 p-4">
                  <ItemMedia className="translate-none! self-center!">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                      <ExtensionIcon key={item.manifest.icon} src={item.manifest.icon} contribution={entryIcon} />
                    </div>
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    <PanelItemTitle className="mb-0.5 text-sm font-medium">{name}</PanelItemTitle>
                    {description && (
                      <ItemDescription className="line-clamp-1 text-xs leading-5">{description}</ItemDescription>
                    )}
                    <ItemDescription className="truncate text-xs leading-5">
                      {item.manifest.author && (
                        <>
                          {item.manifest.authorUrl ? (
                            <a
                              href={item.manifest.authorUrl}
                              rel="noopener noreferrer"
                              className="underline-offset-4 hover:text-foreground hover:underline"
                              onClick={(event) => {
                                event.preventDefault()
                                void openExternal(event.currentTarget.href).catch((error: unknown) =>
                                  toast.error(error instanceof Error ? error.message : String(error))
                                )
                              }}
                            >
                              {item.manifest.author}
                            </a>
                          ) : (
                            item.manifest.author
                          )}
                          {" / "}
                        </>
                      )}
                      v{item.manifest.version}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions className="grid shrink-0 grid-cols-[auto_1.5rem]">
                    <Switch
                      aria-label={t("extensions.enable", { name })}
                      checked={item.enabled}
                      disabled={blocked}
                      onCheckedChange={(enabled) =>
                        onRequest(
                          enabled
                            ? { type: "enable", id: item.id }
                            : { type: "beginTransition", id: item.id, action: "disable" }
                        )
                      }
                    />
                    {(surfaces.length > 0 || actions.update || actions.uninstall || onReload) && (
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              disabled={blocked}
                              aria-label={t("extensions.moreActions", { name })}
                              className="text-muted-foreground"
                            />
                          }
                        >
                          <MoreVerticalIcon />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-max min-w-[140px] whitespace-nowrap">
                          {surfaces.map((view) => {
                            const Icon = EXTENSION_ICONS[view.icon ?? "blocks"]
                            return (
                              <DropdownMenuItem
                                key={view.id}
                                disabled={blocked || !item.enabled || Boolean(error)}
                                onClick={() => onOpenSurface?.(view.id)}
                              >
                                <Icon />
                                {view.title}
                              </DropdownMenuItem>
                            )
                          })}
                          {actions.update && (
                            <DropdownMenuItem disabled={blocked} onClick={() => onInstall(item.id)}>
                              <CircleArrowUpIcon />
                              {t("extensions.update")}
                            </DropdownMenuItem>
                          )}
                          {onReload && (
                            <DropdownMenuItem
                              disabled={blocked || !item.enabled}
                              title={t("extensions.reloadHint")}
                              onClick={() => onReload(item.id)}
                            >
                              <RefreshCwIcon />
                              {t("extensions.reload")}
                            </DropdownMenuItem>
                          )}
                          {actions.uninstall && (
                            <DropdownMenuItem
                              disabled={blocked}
                              className="text-destructive"
                              onClick={() => onUninstall(item.id, name)}
                            >
                              <Trash2Icon />
                              {t("extensions.uninstall")}
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </ItemActions>
                </PanelItem>
                {item.source === LEGACY_SOURCE &&
                  findLegacyProfile(item.id)?.limitations.map((message) => {
                    const key = JSON.stringify([item.installationId, item.packageRevision, message])
                    if (dismissedNotices.has(key)) return null
                    return (
                      <Alert key={key} className="mt-2 pr-10">
                        <AlertDescription className="text-xs leading-relaxed">{message}</AlertDescription>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="absolute top-2 right-2 text-muted-foreground"
                          aria-label={t("actions.close")}
                          onClick={() => setDismissedNotices((previous) => new Set(previous).add(key))}
                        >
                          <XIcon />
                        </Button>
                      </Alert>
                    )
                  })}
                {error && (
                  <Alert variant="destructive" className="mt-2">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                {pending && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-sm text-muted-foreground" role="status">
                      {t("extensions.stopping", { count: pending.waitingInstances })}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={unavailable}
                      onClick={() => onRequest({ type: "abortTransition", id: item.id })}
                    >
                      {t("extensions.cancel")}
                    </Button>
                  </div>
                )}
                {host.views
                  .filter((view) => view.extensionId === item.id && view.kind === "settings")
                  .map((view) => (
                    <div key={view.id} className="px-3 pt-2 pb-4">
                      {renderSettings(view)}
                    </div>
                  ))}
              </section>
            )
          })}
        </PanelList>
      </div>
    </div>
  )
}
