import { parseManifestIcon, resolveManifestText } from "@alwith/module-extension"
import type { HostSnapshot, RuntimeSnapshot, ViewContribution } from "@alwith/module-extension/host"
import type { Request } from "@alwith/module-extension/tauri"
import { BlocksIcon, CircleArrowUpIcon, MoreVerticalIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { useId, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { openExternal } from "@/lib/open"

import { EXTENSION_ICONS } from "./extension-icons"
import { extensionActions } from "./policy"

interface ExtensionsManagerProps {
  state: RuntimeSnapshot
  host: HostSnapshot
  busy: boolean
  onInstall(id?: string): void
  onRequest(request: Request): void
  onUninstall(id: string, name: string): void
  renderSettings(view: ViewContribution): ReactNode
}

function ExtensionIcon({ src }: { src?: string }): ReactNode {
  const [failed, setFailed] = useState(false)
  const icon = src ? parseManifestIcon(src) : undefined
  if (icon?.type === "lucide") {
    const Icon = EXTENSION_ICONS[icon.name]
    return <Icon className="text-muted-foreground size-8" />
  }
  return src && !failed ? (
    <img
      src={src}
      alt=""
      className="size-10 rounded-sm object-contain"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  ) : (
    <BlocksIcon className="text-muted-foreground size-5" />
  )
}

/** Desktop's extension page layout, backed exclusively by the independent extension runtime. */
export function ExtensionsManager({
  state,
  host,
  busy,
  onInstall,
  onRequest,
  onUninstall,
  renderSettings
}: ExtensionsManagerProps) {
  const { t, i18n } = useTranslation()
  const [query, setQuery] = useState("")
  const detailsId = useId()
  const search = query.trim().toLocaleLowerCase()
  const installations = state.native?.installations ?? []
  const matches = installations
    .map(item => ({ item, ...resolveManifestText(item.manifest, i18n.language) }))
    .filter(({ item, name, description }) =>
      [name, item.id, item.manifest.version, description, item.manifest.author]
        .join(" ")
        .toLocaleLowerCase()
        .includes(search)
    )
  const unavailable = busy || state.native === null
  return (
    <div className="@container flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold">{t("sidebar.extensions")}</h1>
          <Badge className="bg-primary/10 text-primary text-[10px]">BETA</Badge>
        </div>
        <Button variant="outline" size="sm" disabled={unavailable} onClick={() => onInstall()}>
          <PlusIcon />
          {t("extensions.install")}
        </Button>
      </div>
      {state.errors.service && (
        <Alert variant="destructive">
          <AlertDescription>{state.errors.service}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-4">
        <Input
          type="search"
          aria-label={t("extensions.search")}
          placeholder={t("extensions.search")}
          value={query}
          onChange={event => setQuery(event.currentTarget.value)}
        />
        {state.native === null && !state.errors.service && (
          <div role="status" className="text-muted-foreground flex items-center justify-center gap-2 py-12 text-sm">
            <Spinner />
            {t("extensions.loading")}
          </div>
        )}
        {state.native !== null && matches.length === 0 && (
          <p className="text-muted-foreground py-12 text-center text-sm">
            {t(installations.length === 0 ? "extensions.empty" : "extensions.noMatches")}
          </p>
        )}
        <PanelList className="grid grid-cols-1 gap-x-4 gap-y-3 @2xl:grid-cols-2">
          {matches.map(({ item, name, description }) => {
            const actions = extensionActions(item)
            const pending = state.native?.pending.find(value => value.id === item.id)
            const error = state.errors[item.id]
            const blocked = unavailable || Boolean(pending)
            return (
              <section key={item.installationId} aria-label={name} className="min-w-0">
                <PanelItem className="group/extension rounded-md py-3">
                  <ItemMedia>
                    <div className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-sm">
                      <ExtensionIcon key={item.manifest.icon} src={item.manifest.icon} />
                    </div>
                  </ItemMedia>
                  <Tooltip>
                    <TooltipTrigger
                      delay={300}
                      render={
                        <ItemContent
                          className="focus-visible:ring-ring min-w-0 rounded-sm outline-none focus-visible:ring-2"
                          role="group"
                          tabIndex={0}
                          aria-label={t("extensions.details.label", { name })}
                          aria-describedby={`${detailsId}-${item.id}`}
                        />
                      }>
                      <PanelItemTitle className="mb-0.5">{name}</PanelItemTitle>
                      {description && <ItemDescription className="line-clamp-1">{description}</ItemDescription>}
                      <ItemDescription className="truncate">
                        {item.manifest.author && (
                          <>
                            {item.manifest.authorUrl ? (
                              <a
                                href={item.manifest.authorUrl}
                                rel="noopener noreferrer"
                                className="hover:text-foreground underline-offset-4 hover:underline"
                                onClick={event => {
                                  event.preventDefault()
                                  void openExternal(event.currentTarget.href).catch((error: unknown) =>
                                    toast.error(error instanceof Error ? error.message : String(error))
                                  )
                                }}>
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
                    </TooltipTrigger>
                    <TooltipContent
                      id={`${detailsId}-${item.id}`}
                      role="tooltip"
                      side="bottom"
                      sideOffset={8}
                      align="start"
                      className="bg-popover text-popover-foreground border-border [&>[aria-hidden=true]]:border-border [&>[aria-hidden=true]]:bg-popover [&>[aria-hidden=true]]:fill-popover block w-96 max-w-[calc(100vw-2rem)] space-y-3 rounded-lg border p-4 leading-relaxed break-words shadow-md [&>[aria-hidden=true][data-side=bottom]]:border-t [&>[aria-hidden=true][data-side=bottom]]:border-l [&>[aria-hidden=true][data-side=top]]:border-r [&>[aria-hidden=true][data-side=top]]:border-b">
                      <p className="text-sm font-medium">{name}</p>
                      {description && <p className="text-muted-foreground whitespace-pre-wrap">{description}</p>}
                      <dl className="border-border [&>dt]:text-muted-foreground grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 border-t pt-3">
                        <dt>ID</dt>
                        <dd className="break-all">{item.id}</dd>
                        <dt>{t("extensions.details.version")}</dt>
                        <dd>{item.manifest.version}</dd>
                        {item.manifest.author && (
                          <>
                            <dt>{t("extensions.details.author")}</dt>
                            <dd>{item.manifest.author}</dd>
                          </>
                        )}
                        {item.manifest.authorUrl && (
                          <>
                            <dt>{t("extensions.details.homepage")}</dt>
                            <dd className="break-all">{item.manifest.authorUrl}</dd>
                          </>
                        )}
                      </dl>
                    </TooltipContent>
                  </Tooltip>
                  <ItemActions className="grid shrink-0 grid-cols-[auto_1.5rem]">
                    <Switch
                      aria-label={t("extensions.enable", { name })}
                      checked={item.enabled}
                      disabled={blocked}
                      onCheckedChange={enabled =>
                        onRequest(
                          enabled
                            ? { type: "enable", id: item.id }
                            : { type: "beginTransition", id: item.id, action: "disable" }
                        )
                      }
                    />
                    {(actions.update || actions.uninstall) && (
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
                          }>
                          <MoreVerticalIcon />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-max min-w-[140px] whitespace-nowrap">
                          {actions.update && (
                            <DropdownMenuItem disabled={blocked} onClick={() => onInstall(item.id)}>
                              <CircleArrowUpIcon />
                              {t("extensions.update")}
                            </DropdownMenuItem>
                          )}
                          {actions.uninstall && (
                            <DropdownMenuItem
                              disabled={blocked}
                              className="text-destructive"
                              onClick={() => onUninstall(item.id, name)}>
                              <Trash2Icon />
                              {t("extensions.uninstall")}
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </ItemActions>
                </PanelItem>
                {error && (
                  <Alert variant="destructive" className="mt-2">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                {pending && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-muted-foreground text-sm" role="status">
                      {t("extensions.stopping", { count: pending.waitingInstances })}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={unavailable}
                      onClick={() => onRequest({ type: "abortTransition", id: item.id })}>
                      {t("extensions.cancel")}
                    </Button>
                  </div>
                )}
                {host.views
                  .filter(view => view.extensionId === item.id && view.kind === "settings")
                  .map(view => (
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
