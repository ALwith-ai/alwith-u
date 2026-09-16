// The official plugin detail page (`plugin/read`): breadcrumb, logo + name + developer +
// category, Install / Manage + more actions, then Description, Includes (Skills, Apps, MCP
// servers, Hooks) and Information (Developer, Category, Version, Website, Capabilities,
// Privacy Policy, Terms of Service).
import { ExternalLinkIcon, MoreHorizontalIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useStore } from "zustand"
import type { PluginDetail } from "@/agent/codex-extensions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { openExternal } from "@/lib/open"
import { pluginsStore } from "./instance"
import { PluginActionButton } from "./plugin-card"
import { PluginIcon, SkillIcon } from "./plugin-icon"
import { type PluginEntry, pluginTitle } from "./store"

function Breadcrumb({ items }: { items: Array<{ label: string; onClick?: () => void }> }) {
  return (
    <nav className="text-muted-foreground flex items-center gap-1 text-xs">
      {items.map((item, index) => (
        <span key={index} className="flex items-center gap-1">
          {index > 0 && <span aria-hidden="true">/</span>}
          {item.onClick ? (
            <button type="button" className="hover:text-foreground" onClick={item.onClick}>
              {item.label}
            </button>
          ) : (
            <span className="text-foreground">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="min-w-0 text-end">{children}</span>
    </div>
  )
}

function LinkRow({ label, url }: { label: string; url: string | null | undefined }) {
  const { t } = useTranslation()
  return (
    <InfoRow label={label}>
      {url ? (
        <button type="button" className="inline-flex items-center gap-1 hover:underline" onClick={() => void openExternal(url)}>
          <span className="truncate">{url.replace(/^https?:\/\//, "")}</span>
          <ExternalLinkIcon className="size-3 shrink-0" aria-hidden="true" />
        </button>
      ) : (
        <span className="text-muted-foreground">{t("plugins.detail.unavailable")}</span>
      )}
    </InfoRow>
  )
}

export function PluginDetailPage({
  entry,
  onBack,
  onInstall,
  onManage
}: {
  entry: PluginEntry
  onBack: () => void
  onInstall: (entry: PluginEntry) => void
  onManage: () => void
}) {
  const { t } = useTranslation()
  const [detail, setDetail] = useState<PluginDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const installed = useStore(pluginsStore, state => state.installed.some(item => item.plugin.id === entry.plugin.id))
  const uninstall = useStore(pluginsStore, state => state.uninstall)
  const plugin = detail?.summary ?? entry.plugin
  const ui = plugin.interface

  useEffect(() => {
    let alive = true
    setDetail(null)
    setError(null)
    pluginsStore
      .getState()
      .readPlugin(entry)
      .then(result => {
        if (alive) setDetail(result)
      })
      .catch((failure: unknown) => {
        if (alive) setError(failure instanceof Error ? failure.message : String(failure))
      })
    return () => {
      alive = false
    }
  }, [entry, installed])

  const description = detail?.description ?? ui?.longDescription ?? ui?.shortDescription ?? null

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <Breadcrumb items={[{ label: t("plugins.detail.root"), onClick: onBack }, { label: pluginTitle(plugin) }]} />
      <header className="flex items-start gap-4">
        <PluginIcon plugin={plugin} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold">{pluginTitle(plugin) || t("plugins.detail.fallbackTitle")}</h1>
          <p className="text-muted-foreground flex flex-wrap gap-x-3 text-sm">
            {ui?.developerName && <span>{t("plugins.installModal.developedBy", { developerName: ui.developerName })}</span>}
            {ui?.category && <span>{ui.category}</span>}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <PluginActionButton entry={entry} installed={installed} size="default" onInstall={() => onInstall(entry)} onManage={onManage} />
          {installed && (
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label={t("plugins.detail.moreActions")} />}>
                <MoreHorizontalIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[160px]">
                <DropdownMenuItem
                  className="text-destructive"
                  disabled={plugin.installPolicy === "INSTALLED_BY_DEFAULT"}
                  onClick={() => void uninstall(plugin)}>
                  {t("plugins.detail.uninstall")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto pb-6">
        {error !== null && (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t("plugins.detail.errorTitle")}</EmptyTitle>
              <EmptyDescription className="font-mono">{error}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {description && (
          <section id="plugin-description">
            <p className="text-sm whitespace-pre-wrap">{description}</p>
          </section>
        )}
        {detail === null && error === null ? (
          <div className="flex flex-col gap-2" aria-label={t("plugins.detail.loading")}>
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        ) : detail !== null ? (
          <>
            {detail.skills.length > 0 && (
              <section className="flex flex-col gap-2">
                <h2 className="text-sm font-semibold">{t("plugins.detail.skills")}</h2>
                <ul className="flex flex-col gap-1">
                  {detail.skills.map(skill => (
                    <li key={skill.name} className="flex items-center gap-3 rounded-lg border p-2">
                      <SkillIcon skill={skill} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm">{skill.interface?.displayName ?? skill.name}</div>
                        <div className="text-muted-foreground truncate text-xs">
                          {skill.interface?.shortDescription ?? skill.shortDescription ?? skill.description}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {detail.apps.length > 0 && (
              <section className="flex flex-col gap-2">
                <h2 className="text-sm font-semibold">{t("plugins.detail.apps")}</h2>
                <ul className="flex flex-col gap-1">
                  {detail.apps.map(app => (
                    <li key={app.id} className="rounded-lg border p-2 text-sm">
                      <div className="truncate">{app.name}</div>
                      {app.description && <div className="text-muted-foreground truncate text-xs">{app.description}</div>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {detail.mcpServers.length > 0 && (
              <section className="flex flex-col gap-2">
                <h2 className="text-sm font-semibold">{t("plugins.detail.mcpServers")}</h2>
                <div className="flex flex-wrap gap-1">
                  {detail.mcpServers.map(server => (
                    <Badge key={server} variant="secondary">
                      {server}
                    </Badge>
                  ))}
                </div>
              </section>
            )}
            {detail.hooks.length > 0 && (
              <section className="flex flex-col gap-2">
                <h2 className="text-sm font-semibold">{t("plugins.detail.hooks")}</h2>
                <div className="flex flex-wrap gap-1">
                  {detail.hooks.map(hook => (
                    <Badge key={hook.key} variant="secondary">
                      {hook.eventName}
                    </Badge>
                  ))}
                </div>
              </section>
            )}
          </>
        ) : null}
        <section className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold">{t("plugins.detail.information")}</h2>
          <Separator />
          <InfoRow label={t("plugins.detail.developer")}>
            {ui?.developerName ?? <span className="text-muted-foreground">{t("plugins.detail.unavailable")}</span>}
          </InfoRow>
          <InfoRow label={t("plugins.detail.category")}>
            {ui?.category ?? <span className="text-muted-foreground">{t("plugins.detail.unavailable")}</span>}
          </InfoRow>
          <InfoRow label={t("plugins.detail.version")}>
            {plugin.localVersion ?? plugin.version ?? <span className="text-muted-foreground">{t("plugins.detail.unavailable")}</span>}
          </InfoRow>
          <LinkRow label={t("plugins.detail.website")} url={ui?.websiteUrl} />
          {ui && ui.capabilities.length > 0 && (
            <InfoRow label={t("plugins.detail.capabilities")}>
              <span className="flex flex-wrap justify-end gap-1">
                {ui.capabilities.map(capability => (
                  <Badge key={capability} variant="secondary">
                    {capability}
                  </Badge>
                ))}
              </span>
            </InfoRow>
          )}
          <LinkRow label={t("plugins.detail.privacyPolicy")} url={ui?.privacyPolicyUrl} />
          <LinkRow label={t("plugins.detail.termsOfService")} url={ui?.termsOfServiceUrl} />
        </section>
      </div>
    </div>
  )
}
