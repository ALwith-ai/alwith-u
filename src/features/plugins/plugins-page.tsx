import { convertFileSrc } from "@tauri-apps/api/core"
// Skills and plugins store, reduced from ALwith Desktop's extensions page: title + BETA,
// Marketplace / Installed tabs, PanelItem rows with icon box, title, description and
// the install / installing / installed action button. Data is Codex's own catalog
// (`_codex/plugin_*`, `_codex/skills_*`); Desktop's registry fetch, zip download progress
// and version-diff "update" state have no counterpart here and are dropped.
import { CircleArrowUpIcon, MoreVerticalIcon, PlusIcon, SparklesIcon, Trash2Icon } from "lucide-react"
import { memo, useDeferredValue, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useStore } from "zustand"

import type { PluginMarketplaceEntry, PluginSummary, SkillMetadata } from "@/agent/codex-extensions"
import { hasPluginStore } from "@/agent/codex-extensions"
import { Pane } from "@/components/alwith-ui/pane"
import {
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  PanelItem,
  PanelItemTitle,
  PanelList
} from "@/components/alwith-ui/panel-item"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Item } from "@/components/ui/item"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { client, useApp } from "@/lib/client"

import { pluginsStore } from "./instance"
import { PluginIcon, PluginIconDefinitions } from "./plugin-icon"

/**
 * Codex skills ship their icon as a file under ~/.codex (`interface.iconSmall`); the remote
 * catalog gives a URL instead. The local file is served through Tauri's asset protocol.
 */
function skillIconSrc(skill: SkillMetadata): string | null {
  const local = skill.interface?.iconSmall
  if (typeof local === "string" && local.length > 0) return convertFileSrc(local)
  return skill.interface?.iconSmallUrl ?? null
}

/** Icon box: 40 (size-10) outside, 20 (size-5) inside; an image when the catalog has one. */
function SkillIconBox({ src }: { src: string | null }) {
  return (
    <ItemMedia>
      <div className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-muted">
        {src ? (
          <img src={src} alt="" className="size-8 rounded-sm object-cover" />
        ) : (
          <SparklesIcon className="size-5 text-muted-foreground" />
        )}
      </div>
    </ItemMedia>
  )
}

function pluginTitle(plugin: PluginSummary): string {
  return plugin.interface?.displayName ?? plugin.name
}

function pluginDescription(plugin: PluginSummary): string {
  return plugin.interface?.shortDescription ?? ""
}

/** Install / installing spinner / installed (disabled), as Desktop's MarketplaceActionButton. */
function PluginActionButton({ plugin, marketplace }: { plugin: PluginSummary; marketplace: PluginMarketplaceEntry }) {
  const { t } = useTranslation()
  const installing = useStore(pluginsStore, state => plugin.id in state.busyIds)
  const installed = useStore(pluginsStore, state => state.installed.some(entry => entry.plugin.id === plugin.id))
  const install = useStore(pluginsStore, state => state.install)
  const unavailable = plugin.availability !== "AVAILABLE" || plugin.installPolicy === "NOT_AVAILABLE"
  if (installing) {
    return (
      <Button size="sm" variant="outline" disabled className="w-20" aria-label={t("plugins.card.installing")}>
        <Spinner />
      </Button>
    )
  }
  if (installed) {
    return (
      <Button size="sm" variant="outline" disabled className="w-20">
        {t("plugins.sections.installed")}
      </Button>
    )
  }
  return (
    <Button
      size="sm"
      variant="outline"
      className="w-20"
      disabled={unavailable}
      title={unavailable ? t("plugins.disabledReason.unknown") : undefined}
      onClick={() => void install({ plugin, marketplace }).catch(() => {})}>
      {t("plugins.card.install")}
    </Button>
  )
}

function PluginRow({
  plugin,
  marketplace,
  actions
}: {
  plugin: PluginSummary
  marketplace: PluginMarketplaceEntry
  actions: React.ReactNode
}) {
  const description = pluginDescription(plugin)
  const developer = plugin.interface?.developerName
  const version = plugin.localVersion ?? plugin.version
  const meta = [developer, version ? `v${version}` : null].filter(Boolean).join(" · ")
  return (
    <PanelItem className="rounded-md">
      <ItemMedia>
        <div className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-muted">
          <PluginIcon name={plugin.name} />
        </div>
      </ItemMedia>
      <ItemContent className="min-w-0">
        <PanelItemTitle className="mb-0.5">{pluginTitle(plugin)}</PanelItemTitle>
        <ItemDescription className="line-clamp-1" title={description}>
          {description || marketplace.interface?.displayName || marketplace.name}
        </ItemDescription>
        {meta && <ItemDescription className="-mt-0.5 opacity-60">{meta}</ItemDescription>}
      </ItemContent>
      <ItemActions>{actions}</ItemActions>
    </PanelItem>
  )
}

/** Catalog data comes from Codex: until the engine is connected the page is loading. */
function usePluginsReady(): boolean {
  return useApp(state => state.connection === "ready" && hasPluginStore(state.agent))
}

const PAGE_SIZE = 48

function MarketplaceSection({
  marketplace,
  plugins
}: {
  marketplace: PluginMarketplaceEntry
  plugins: PluginSummary[]
}) {
  const { t } = useTranslation()
  const removeMarketplace = useStore(pluginsStore, state => state.removeMarketplace)

  const [selectedPage, setPage] = useState(0)
  const page = Math.min(selectedPage, Math.max(0, Math.ceil(plugins.length / PAGE_SIZE) - 1))
  if (plugins.length === 0) return null
  return (
    <section key={marketplace.name} className="flex flex-col gap-1">
      <div className="flex items-center gap-2 px-2">
        <h2 className="text-xs font-medium text-muted-foreground">
          {marketplace.interface?.displayName ?? marketplace.name}
        </h2>
        <span className="text-xs text-muted-foreground opacity-60">{plugins.length}</span>
        {marketplace.path !== null && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="ms-auto text-muted-foreground"
                  aria-label={t("plugins.pageActions")}
                />
              }>
              <MoreVerticalIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[140px]">
              <DropdownMenuItem className="text-destructive" onClick={() => void removeMarketplace(marketplace.name)}>
                <Trash2Icon className="me-2 size-3.5" />
                {t("plugins.marketplace.remove")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <PanelList className="grid grid-cols-2 gap-2">
        {plugins.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(plugin => (
          <PluginRow
            key={plugin.remotePluginId ?? plugin.id}
            plugin={plugin}
            marketplace={marketplace}
            actions={<PluginActionButton plugin={plugin} marketplace={marketplace} />}
          />
        ))}
      </PanelList>
      {plugins.length > PAGE_SIZE && (
        <div className="flex items-center justify-end gap-2 px-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
            {t("plugins.previousPage")}
          </Button>
          <span className="text-xs text-muted-foreground">
            {page + 1} / {Math.ceil(plugins.length / PAGE_SIZE)}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={(page + 1) * PAGE_SIZE >= plugins.length}
            onClick={() => setPage(page + 1)}>
            {t("plugins.nextPage")}
          </Button>
        </div>
      )}
    </section>
  )
}

const MarketplaceResults = memo(function MarketplaceResults({ query }: { query: string }) {
  const { t } = useTranslation()
  const marketplaces = useStore(pluginsStore, state => state.marketplaces)
  const featuredIds = useStore(pluginsStore, state => state.featuredPluginIds)
  const index = useMemo(
    () =>
      marketplaces.map(marketplace => ({
        marketplace,
        entries: marketplace.plugins.map(plugin => ({
          plugin,
          text: [
            plugin.name,
            pluginTitle(plugin),
            pluginDescription(plugin),
            plugin.interface?.developerName ?? "",
            ...plugin.keywords
          ]
            .join("\n")
            .toLowerCase()
        }))
      })),
    [marketplaces]
  )
  const sections = useMemo(() => {
    const featured = new Set(featuredIds)
    return index.map(({ marketplace, entries }) => ({
      marketplace,
      plugins: entries
        .filter(({ plugin, text }) =>
          query === "" ? marketplace.path !== null || featured.has(plugin.id) : text.includes(query)
        )
        .map(({ plugin }) => plugin)
    }))
  }, [index, featuredIds, query])
  return (
    <>
      {sections.map(({ marketplace, plugins }) => (
        <MarketplaceSection
          key={JSON.stringify([marketplace.name, marketplace.path, query])}
          marketplace={marketplace}
          plugins={plugins}
        />
      ))}
      {query && sections.every(section => section.plugins.length === 0) && (
        <p className="px-2 py-6 text-center text-sm text-muted-foreground">{t("plugins.empty")}</p>
      )}
    </>
  )
})

function MarketplaceSkeleton() {
  const { t } = useTranslation()
  return (
    <div role="status" aria-label={t("plugins.loading")} className="mx-2 my-3 flex flex-col gap-3">
      <Skeleton className="h-4 w-36" />
      <PanelList className="grid grid-cols-2 gap-2 px-0" aria-hidden="true">
        {[1, 2, 3, 4, 5, 6, 7, 8].map(id => (
          <Item key={id} size="xs">
            <ItemMedia>
              <Skeleton className="size-10 rounded-sm" />
            </ItemMedia>
            <ItemContent className="min-w-0 group-data-[size=xs]/item:gap-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-1/3" />
            </ItemContent>
            <ItemActions>
              <Skeleton className="h-8 w-20" />
            </ItemActions>
          </Item>
        ))}
      </PanelList>
    </div>
  )
}

function MarketplaceTab() {
  const { t } = useTranslation()
  const ready = usePluginsReady()
  const marketplaces = useStore(pluginsStore, state => state.marketplaces)
  const loadErrors = useStore(pluginsStore, state => state.marketplaceLoadErrors)
  const error = useStore(pluginsStore, state => state.error)
  const refresh = useStore(pluginsStore, state => state.refresh)
  const loading = useStore(pluginsStore, state => state.loading) || !ready
  const addMarketplace = useStore(pluginsStore, state => state.addMarketplace)
  const upgrade = useStore(pluginsStore, state => state.upgradeAll)
  const upgrading = useStore(pluginsStore, state => state.upgrading)
  const [query, setQuery] = useState("")
  const [source, setSource] = useState("")
  const q = useDeferredValue(query.trim().toLowerCase())

  const submitSource = () => {
    const value = source.trim()
    if (!value) return
    setSource("")
    void addMarketplace({ source: value })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex items-center gap-2">
        <Input value={query} onChange={e => setQuery(e.target.value)} placeholder={t("plugins.search")} />
        <Button
          size="sm"
          variant="outline"
          disabled={!ready || upgrading}
          aria-busy={upgrading}
          onClick={() => void upgrade()}>
          {upgrading ? <Spinner /> : <CircleArrowUpIcon data-icon="inline-start" />}
          {t("plugins.marketplace.upgradeAll")}
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Input
          value={source}
          onChange={e => setSource(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") submitSource()
          }}
          placeholder={t("plugins.marketplace.sourcePlaceholder")}
        />
        <Button size="sm" variant="outline" disabled={loading || source.trim() === ""} onClick={submitSource}>
          <PlusIcon data-icon="inline-start" />
          {t("plugins.addMarketplace")}
        </Button>
      </div>
      <Pane>
        <div className="flex flex-col gap-4">
          {error && (
            <div role="alert" className="px-2 text-xs text-destructive">
              <p>
                {t("plugins.loadError.title")}: {error}
              </p>
              <Button size="sm" variant="outline" disabled={loading} onClick={() => void refresh()}>
                {t("plugins.loadError.retry")}
              </Button>
            </div>
          )}
          {loadErrors.map(error => (
            <p key={error.marketplacePath} className="px-2 text-xs text-destructive">
              {error.marketplacePath}: {error.message}
            </p>
          ))}
          {loading ? <MarketplaceSkeleton /> : <MarketplaceResults query={q} />}
          {!loading && marketplaces.every(marketplace => marketplace.plugins.length === 0) && (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">{t("plugins.empty")}</p>
          )}
        </div>
      </Pane>
    </div>
  )
}

function SkillRow({ skill }: { skill: SkillMetadata }) {
  const { t } = useTranslation()
  const setSkillEnabled = useStore(pluginsStore, state => state.setSkillEnabled)
  const title = skill.interface?.displayName ?? skill.name
  const description = skill.interface?.shortDescription ?? skill.shortDescription ?? skill.description
  return (
    <PanelItem className="rounded-md">
      <SkillIconBox src={skillIconSrc(skill)} />
      <ItemContent className="min-w-0">
        <div className="mb-0.5 flex items-center gap-1.5">
          <PanelItemTitle className="w-auto min-w-0">{title}</PanelItemTitle>
          <Badge variant="secondary" className="shrink-0 text-[10px]">
            {t(`plugins.skills.scope.${skill.scope}`)}
          </Badge>
        </div>
        <ItemDescription className="line-clamp-1" title={description}>
          {description}
        </ItemDescription>
        <ItemDescription className="-mt-0.5 opacity-60" title={skill.path}>
          {skill.pluginId ?? skill.path}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Switch
          checked={skill.enabled}
          aria-label={t(skill.enabled ? "plugins.skills.disable" : "plugins.skills.enable")}
          onCheckedChange={checked => void setSkillEnabled(skill, checked)}
        />
      </ItemActions>
    </PanelItem>
  )
}

function InstalledTab() {
  const { t } = useTranslation()
  const ready = usePluginsReady()
  const installed = useStore(pluginsStore, state => state.installed)
  const busyIds = useStore(pluginsStore, state => state.busyIds)
  const uninstall = useStore(pluginsStore, state => state.uninstall)
  const setPluginEnabled = useStore(pluginsStore, state => state.setPluginEnabled)
  const skills = useStore(pluginsStore, state => state.skills)
  const skillErrors = useStore(pluginsStore, state => state.skillErrors)
  return (
    <Pane>
      <div className="flex flex-col gap-4">
        <section className="flex flex-col gap-1">
          <h2 className="px-2 text-xs font-medium text-muted-foreground">{t("plugins.headings.plugins")}</h2>
          {!ready ? (
            <Spinner className="mx-2 my-4 text-muted-foreground" />
          ) : installed.length === 0 ? (
            <p className="px-2 py-4 text-sm text-muted-foreground">{t("plugins.sections.installedEmpty")}</p>
          ) : (
            <PanelList className="grid grid-cols-2 gap-2">
              {installed.map(({ plugin, marketplace }) => (
                <PluginRow
                  key={plugin.id}
                  plugin={plugin}
                  marketplace={marketplace}
                  actions={
                    <>
                      {plugin.id in busyIds && <Spinner className="size-3.5 text-muted-foreground" />}
                      <Switch
                        checked={plugin.enabled}
                        disabled={plugin.id in busyIds || plugin.availability !== "AVAILABLE"}
                        aria-label={t(plugin.enabled ? "plugins.card.disable" : "plugins.card.enable", {
                          pluginName: pluginTitle(plugin)
                        })}
                        onCheckedChange={enabled => void setPluginEnabled(plugin, enabled)}
                      />
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              className="text-muted-foreground"
                              aria-label={t("plugins.card.moreActions")}
                            />
                          }>
                          <MoreVerticalIcon />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-[140px]">
                          <DropdownMenuItem
                            className="text-destructive"
                            disabled={plugin.id in busyIds}
                            onClick={() => void uninstall(plugin)}>
                            <Trash2Icon className="me-2 size-3.5" />
                            {t("plugins.card.uninstall")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </>
                  }
                />
              ))}
            </PanelList>
          )}
        </section>
        <section className="flex flex-col gap-1">
          <h2 className="px-2 text-xs font-medium text-muted-foreground">{t("plugins.headings.skills")}</h2>
          {skillErrors.map(error => (
            <p key={error.path} className="px-2 text-xs text-destructive">
              {error.path}: {error.message}
            </p>
          ))}
          {!ready ? (
            <Spinner className="mx-2 my-4 text-muted-foreground" />
          ) : skills.length === 0 ? (
            <p className="px-2 py-4 text-sm text-muted-foreground">{t("plugins.skills.empty")}</p>
          ) : (
            <PanelList className="grid grid-cols-2 gap-2">
              {skills.map(skill => (
                <SkillRow key={skill.path} skill={skill} />
              ))}
            </PanelList>
          )}
        </section>
      </div>
    </Pane>
  )
}

/** `cwd`: the selected project; repo-scoped skills and marketplaces are read from it. */
export function PluginsPage({ cwd, active }: { cwd: string | null; active: boolean }) {
  const { t } = useTranslation()
  const refresh = useStore(pluginsStore, state => state.refresh)
  const ready = usePluginsReady()

  useEffect(() => {
    // The screen arrow is available even before the engine has connected.
    if (!active || !ready) return
    void refresh(cwd === null ? [] : [cwd])
    return client.onSkillsChanged(() => void refresh(undefined, { background: true }))
  }, [active, ready, refresh, cwd])

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PluginIconDefinitions />
      <div className="mx-auto w-full max-w-5xl shrink-0 px-6 pt-8">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold">{t("plugins.title")}</h1>
          <Badge variant="secondary" className="text-[10px] normal-case">
            {t("plugins.beta")}
          </Badge>
        </div>
      </div>
      <div className="mx-auto mt-4 flex min-h-0 w-full max-w-5xl flex-1 flex-col px-6 pb-6">
        <Tabs defaultValue="marketplace" className="flex min-h-0 flex-1 flex-col gap-4">
          <TabsList>
            <TabsTrigger value="marketplace">{t("plugins.headings.marketplace")}</TabsTrigger>
            <TabsTrigger value="installed">{t("plugins.sections.installed")}</TabsTrigger>
          </TabsList>
          <TabsContent value="marketplace" className="flex min-h-0 flex-1 flex-col">
            <MarketplaceTab />
          </TabsContent>
          <TabsContent value="installed" className="flex min-h-0 flex-1 flex-col">
            <InstalledTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
