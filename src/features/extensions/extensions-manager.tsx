import type { HostSnapshot, RuntimeSnapshot, ViewContribution } from "@alwith/module-extension/host"
import type { Request } from "@alwith/module-extension/tauri"
import { BlocksIcon, CircleArrowUpIcon, MoreVerticalIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
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

interface ExtensionsManagerProps {
  state: RuntimeSnapshot
  host: HostSnapshot
  busy: boolean
  onInstall(id?: string): void
  onRequest(request: Request): void
  onUninstall(id: string, name: string): void
  renderSettings(view: ViewContribution): ReactNode
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
  const { t } = useTranslation()
  const [query, setQuery] = useState("")
  const search = query.trim().toLocaleLowerCase()
  const installations = state.native?.installations ?? []
  const matches = installations.filter(item =>
    `${item.manifest.name} ${item.id} ${item.manifest.version}`.toLocaleLowerCase().includes(search)
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
          {matches.map(item => {
            const pending = state.native?.pending.find(value => value.id === item.id)
            const instance = host.instances.find(value => value.id === item.id)
            const error = state.errors[item.id]
            const blocked = unavailable || Boolean(pending)
            return (
              <section key={item.installationId} aria-label={item.manifest.name} className="min-w-0">
                <PanelItem className="group/extension rounded-md py-3">
                  <ItemMedia>
                    <div className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-sm">
                      <BlocksIcon className="text-muted-foreground size-5" />
                    </div>
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    <PanelItemTitle className="mb-0.5">{item.manifest.name}</PanelItemTitle>
                    <ItemDescription className="truncate" title={item.id}>
                      {item.id}
                    </ItemDescription>
                    <ItemDescription className="-mt-0.5">
                      v{item.manifest.version} ·{" "}
                      {pending
                        ? t("extensions.stopping", { count: pending.waitingInstances })
                        : t(`extensions.status.${instance?.status ?? "inactive"}`)}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Switch
                      aria-label={t("extensions.enable", { name: item.manifest.name })}
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
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            disabled={blocked}
                            aria-label={t("extensions.moreActions", { name: item.manifest.name })}
                            className="text-muted-foreground"
                          />
                        }>
                        <MoreVerticalIcon />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-[140px]">
                        <DropdownMenuItem disabled={blocked} onClick={() => onInstall(item.id)}>
                          <CircleArrowUpIcon />
                          {t("extensions.update")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={blocked}
                          className="text-destructive"
                          onClick={() => onUninstall(item.id, item.manifest.name)}>
                          <Trash2Icon />
                          {t("extensions.uninstall")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </ItemActions>
                </PanelItem>
                {error && (
                  <Alert variant="destructive" className="mt-2">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                {pending && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={unavailable}
                    onClick={() => onRequest({ type: "abortTransition", id: item.id })}>
                    {t("extensions.cancel")}
                  </Button>
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
