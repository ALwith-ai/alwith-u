// Browse and manage Codex plugins and skills from one catalog surface.
import {
  CircleArrowUpIcon,
  MoreVerticalIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  Trash2Icon,
  XIcon
} from "lucide-react"
import { memo, useDeferredValue, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useStore } from "zustand"

import type { PluginMarketplaceEntry, PluginSummary } from "@/agent/codex-extensions"
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
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { newChatDirectory } from "@/features/chat/new-chat-directory"
import { client, useApp } from "@/lib/client"

import { CatalogSkeleton } from "./catalog-skeleton"
import { pluginsStore } from "./instance"
import { PluginDetailPage } from "./plugin-detail-page"
import { PluginIcon, PluginIconDefinitions } from "./plugin-icon"
import { SkillsTab } from "./skills-tab"
import type { PluginEntry } from "./store"

function pluginTitle(plugin: PluginSummary): string {
  return plugin.interface?.displayName ?? plugin.name
}

function pluginDescription(plugin: PluginSummary): string {
  return plugin.interface?.shortDescription ?? ""
}

/** Install / installing spinner / installed (disabled), as Desktop's MarketplaceActionButton. */
function PluginActionButton({ plugin, marketplace }: { plugin: PluginSummary; marketplace: PluginMarketplaceEntry }) {
  const { t } = useTranslation()
  const installing = useStore(pluginsStore, (state) => plugin.id in state.busyIds)
  const installed = useStore(pluginsStore, (state) => state.installed.some((entry) => entry.plugin.id === plugin.id))
  const install = useStore(pluginsStore, (state) => state.install)
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
      onClick={() => void install({ plugin, marketplace }).catch(() => {})}
    >
      {t("plugins.card.install")}
    </Button>
  )
}

function PluginRow({
  plugin,
  marketplace,
  actions,
  onOpen
}: {
  plugin: PluginSummary
  marketplace: PluginMarketplaceEntry
  actions: React.ReactNode
  onOpen: (entry: PluginEntry) => void
}) {
  const description = pluginDescription(plugin)
  const developer = plugin.interface?.developerName
  const version = plugin.localVersion ?? plugin.version
  const meta = [developer, version ? `v${version}` : null].filter(Boolean).join(" · ")
  return (
    <PanelItem className="relative rounded-md">
      <Button
        variant="ghost"
        className="absolute inset-0 z-0 size-full"
        aria-label={pluginTitle(plugin)}
        onClick={() => onOpen({ plugin, marketplace })}
      />
      <ItemMedia className="pointer-events-none relative">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-muted">
          <PluginIcon name={plugin.name} />
        </div>
      </ItemMedia>
      <ItemContent className="pointer-events-none relative min-w-0">
        <PanelItemTitle className="mb-0.5">{pluginTitle(plugin)}</PanelItemTitle>
        <ItemDescription className="line-clamp-1" title={description}>
          {description || marketplace.interface?.displayName || marketplace.name}
        </ItemDescription>
        {meta && <ItemDescription className="-mt-0.5">{meta}</ItemDescription>}
      </ItemContent>
      <ItemActions className="relative">{actions}</ItemActions>
    </PanelItem>
  )
}

/** Catalog data comes from Codex: until the engine is connected the page is loading. */
function usePluginsReady(): boolean {
  return useApp((state) => state.connection === "ready" && hasPluginStore(state.agent))
}

const PAGE_SIZE = 48

function MarketplaceSection({
  marketplace,
  plugins,
  onOpen
}: {
  marketplace: PluginMarketplaceEntry
  plugins: PluginSummary[]
  onOpen: (entry: PluginEntry) => void
}) {
  const { t } = useTranslation()
  const removeMarketplace = useStore(pluginsStore, (state) => state.removeMarketplace)

  const [selectedPage, setPage] = useState(0)
  const page = Math.min(selectedPage, Math.max(0, Math.ceil(plugins.length / PAGE_SIZE) - 1))
  if (plugins.length === 0) return null
  return (
    <section key={marketplace.name} className="flex flex-col gap-1">
      <div className="flex items-center gap-2 px-2">
        <h2 className="text-xs font-medium text-muted-foreground">
          {marketplace.interface?.displayName ?? marketplace.name}
        </h2>
        <span className="text-xs text-muted-foreground">{plugins.length}</span>
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
              }
            >
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
      <PanelList className="grid grid-cols-1 gap-2 @min-[700px]:grid-cols-2">
        {plugins.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((plugin) => (
          <PluginRow
            onOpen={onOpen}
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
            onClick={() => setPage(page + 1)}
          >
            {t("plugins.nextPage")}
          </Button>
        </div>
      )}
    </section>
  )
}

const MarketplaceResults = memo(function MarketplaceResults({
  query,
  onOpen
}: {
  query: string
  onOpen: (entry: PluginEntry) => void
}) {
  const { t } = useTranslation()
  const marketplaces = useStore(pluginsStore, (state) => state.marketplaces)
  const featuredIds = useStore(pluginsStore, (state) => state.featuredPluginIds)
  const index = useMemo(
    () =>
      marketplaces.map((marketplace) => ({
        marketplace,
        entries: marketplace.plugins.map((plugin) => ({
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
          onOpen={onOpen}
        />
      ))}
      {sections.every((section) => section.plugins.length === 0) && (
        <p className="px-2 py-6 text-center text-sm text-muted-foreground">{t("plugins.empty")}</p>
      )}
    </>
  )
})

function PluginToolbar() {
  const { t } = useTranslation()
  const ready = usePluginsReady()
  const addMarketplace = useStore(pluginsStore, (state) => state.addMarketplace)
  const upgrade = useStore(pluginsStore, (state) => state.upgradeAll)
  const upgrading = useStore(pluginsStore, (state) => state.upgrading)
  const [source, setSource] = useState("")
  const [adding, setAdding] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  const submitSource = async () => {
    const value = source.trim()
    if (!value || adding) return
    setAdding(true)
    setAddError(null)
    try {
      await addMarketplace({ source: value })
      setSource("")
      setAddOpen(false)
    } catch (error) {
      setAddError(error instanceof Error ? error.message : String(error))
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={!ready || upgrading}
        aria-busy={upgrading}
        onClick={() => void upgrade()}
      >
        {upgrading ? <Spinner /> : <CircleArrowUpIcon data-icon="inline-start" />}
        {t("plugins.marketplace.upgradeAll")}
      </Button>
      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          if (!adding) setAddOpen(open)
        }}
      >
        <DialogTrigger render={<Button size="sm" variant="outline" disabled={!ready} />}>
          <PlusIcon data-icon="inline-start" />
          {t("plugins.addMarketplace")}
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("plugins.marketplace.addTitle")}</DialogTitle>
            <DialogDescription>{t("plugins.catalog.sourceHelp")}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              void submitSource()
            }}
          >
            <Label htmlFor="marketplace-source">{t("plugins.marketplace.sourceLabel")}</Label>
            <Input
              id="marketplace-source"
              value={source}
              disabled={adding}
              onChange={(event) => setSource(event.target.value)}
              placeholder={t("plugins.marketplace.sourcePlaceholder")}
            />
            {addError && (
              <p role="alert" className="text-sm text-destructive">
                {addError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" disabled={adding} onClick={() => setAddOpen(false)}>
                {t("plugins.marketplace.addCancel")}
              </Button>
              <Button type="submit" disabled={adding || source.trim() === ""}>
                {adding && <Spinner />}
                {t("plugins.marketplace.addSubmit")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function MarketplaceTab({ onOpen, query }: { onOpen: (entry: PluginEntry) => void; query: string }) {
  const ready = usePluginsReady()
  const loadErrors = useStore(pluginsStore, (state) => state.marketplaceLoadErrors)
  const loading = useStore(pluginsStore, (state) => state.loading) || !ready
  const q = useDeferredValue(query.trim().toLowerCase())
  return (
    <Pane>
      <div className="flex flex-col gap-4">
        {loadErrors.map((error) => (
          <p key={error.marketplacePath} className="px-2 text-xs text-destructive">
            {error.marketplacePath}: {error.message}
          </p>
        ))}
        {loading ? <CatalogSkeleton /> : <MarketplaceResults query={q} onOpen={onOpen} />}
      </div>
    </Pane>
  )
}

function InstalledTab({ onOpen, query }: { onOpen: (entry: PluginEntry) => void; query: string }) {
  const { t } = useTranslation()
  const ready = usePluginsReady()
  const installed = useStore(pluginsStore, (state) => state.installed)
  const busyIds = useStore(pluginsStore, (state) => state.busyIds)
  const uninstall = useStore(pluginsStore, (state) => state.uninstall)
  const setPluginEnabled = useStore(pluginsStore, (state) => state.setPluginEnabled)
  const loading = useStore(pluginsStore, (state) => state.loading)
  const filtered = installed.filter(({ plugin }) =>
    [pluginTitle(plugin), pluginDescription(plugin), plugin.name]
      .join(" ")
      .toLowerCase()
      .includes(query.trim().toLowerCase())
  )
  return (
    <Pane>
      <div className="flex flex-col gap-4">
        <section className="flex flex-col gap-1">
          <h2 className="px-2 text-xs font-medium text-muted-foreground">{t("plugins.headings.plugins")}</h2>
          {!ready || loading ? (
            <CatalogSkeleton />
          ) : filtered.length === 0 ? (
            <p className="px-2 py-4 text-sm text-muted-foreground">
              {t(query.trim() ? "plugins.empty" : "plugins.sections.installedEmpty")}
            </p>
          ) : (
            <PanelList className="grid grid-cols-1 gap-2 @min-[700px]:grid-cols-2">
              {filtered.map(({ plugin, marketplace }) => (
                <PluginRow
                  onOpen={onOpen}
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
                        onCheckedChange={(enabled) => void setPluginEnabled(plugin, enabled)}
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
                          }
                        >
                          <MoreVerticalIcon />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-[140px]">
                          <DropdownMenuItem
                            className="text-destructive"
                            disabled={plugin.id in busyIds}
                            onClick={() => void uninstall(plugin)}
                          >
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
      </div>
    </Pane>
  )
}

/** Catalogs cover the selected project and known conversation projects. */
export function PluginsPage({ cwd, active }: { cwd: string | null; active: boolean }) {
  const { t } = useTranslation()
  const refresh = useStore(pluginsStore, (state) => state.refresh)
  const loading = useStore(pluginsStore, (state) => state.loading)
  const error = useStore(pluginsStore, (state) => state.error)
  const [kind, setKind] = useState("plugins")
  const [pluginTab, setPluginTab] = useState("marketplace")
  const [queries, setQueries] = useState({ plugins: "", skills: "" })
  const query = kind === "skills" ? queries.skills : queries.plugins
  const setQuery = (value: string) => setQueries((current) => ({ ...current, [kind]: value }))
  const knownDirectories = useApp((state) =>
    JSON.stringify(
      [
        ...new Set(
          state.threads.map((thread) => newChatDirectory(thread.cwd)).filter((path): path is string => path !== null)
        )
      ].sort()
    )
  )
  const directoriesKey = JSON.stringify(
    [
      ...new Set(
        [newChatDirectory(cwd), ...(JSON.parse(knownDirectories) as string[])].filter(
          (path): path is string => path !== null
        )
      )
    ].sort()
  )
  const searchLabel = t(kind === "skills" ? "plugins.skills.search" : "plugins.search")
  const [selected, setSelected] = useState<PluginEntry | null>(null)
  const ready = usePluginsReady()

  useEffect(() => {
    // The screen arrow is available even before the engine has connected.
    if (!active || !ready) return
    void refresh(JSON.parse(directoriesKey) as string[])
    return client.onSkillsChanged(() => void refresh(undefined, { background: true }))
  }, [active, ready, refresh, directoriesKey])

  return (
    <div className="@container flex h-full flex-col overflow-hidden">
      <PluginIconDefinitions />
      {selected && (
        <PluginDetailPage
          key={JSON.stringify([selected.marketplace.name, selected.marketplace.path, selected.plugin.id, cwd])}
          entry={selected}
          onBack={() => setSelected(null)}
        />
      )}
      <div className={selected ? "hidden" : "flex min-h-0 flex-1 flex-col"}>
        <div className="mx-auto w-full max-w-5xl shrink-0 px-6 pt-8">
          <h1 className="text-2xl font-semibold">{t("plugins.catalog.title")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("plugins.catalog.description")}</p>
        </div>
        <div className="mx-auto mt-4 flex min-h-0 w-full max-w-5xl flex-1 flex-col px-6 pb-6">
          <Tabs
            value={kind}
            onValueChange={(value) => {
              if (typeof value === "string") setKind(value)
            }}
            className="flex min-h-0 flex-1 flex-col gap-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-2">
              <TabsList variant="line" aria-label={t("plugins.manageTabs.aria")}>
                <TabsTrigger data-hover-background="none" value="plugins">
                  {t("plugins.headings.plugins")}
                </TabsTrigger>
                <TabsTrigger data-hover-background="none" value="skills">
                  {t("plugins.headings.skills")}
                </TabsTrigger>
              </TabsList>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("plugins.skills.refresh")}
                disabled={!ready || loading}
                onClick={() => void refresh(undefined, { forceRefetch: true })}
              >
                {loading ? <Spinner /> : <RefreshCwIcon />}
              </Button>
            </div>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="ps-9 pe-9"
                aria-label={searchLabel}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={searchLabel}
              />
              {query && (
                <Button
                  className="absolute end-1 top-1/2 -translate-y-1/2"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t("plugins.catalog.clearSearch")}
                  onClick={() => setQuery("")}
                >
                  <XIcon />
                </Button>
              )}
            </div>
            {error && (
              <div role="alert" className="flex items-center justify-between gap-2 text-sm text-destructive">
                <p>
                  {t("plugins.loadError.title")}: {error}
                </p>
                <Button size="sm" variant="outline" disabled={loading || !ready} onClick={() => void refresh()}>
                  {t("plugins.loadError.retry")}
                </Button>
              </div>
            )}
            <TabsContent value="plugins" keepMounted className="flex min-h-0 flex-1 flex-col data-[hidden]:hidden">
              <Tabs
                value={pluginTab}
                onValueChange={(value) => {
                  if (typeof value === "string") setPluginTab(value)
                }}
                className="flex min-h-0 flex-1 flex-col gap-4"
              >
                <PluginToolbar />
                <TabsList
                  aria-label={t("plugins.catalog.pluginViews")}
                  className="shrink-0 gap-1 rounded-md bg-muted p-1"
                >
                  <TabsTrigger
                    data-hover-background="none"
                    value="marketplace"
                    className="rounded-md px-4 shadow-none! after:hidden data-active:bg-background! dark:data-active:border-transparent"
                  >
                    {t("plugins.headings.marketplace")}
                  </TabsTrigger>
                  <TabsTrigger
                    data-hover-background="none"
                    value="installed"
                    className="rounded-md px-4 shadow-none! after:hidden data-active:bg-background! dark:data-active:border-transparent"
                  >
                    {t("plugins.sections.installed")}
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="marketplace" className="flex min-h-0 flex-1 flex-col">
                  <MarketplaceTab query={queries.plugins} onOpen={setSelected} />
                </TabsContent>
                <TabsContent value="installed" className="flex min-h-0 flex-1 flex-col">
                  <InstalledTab query={queries.plugins} onOpen={setSelected} />
                </TabsContent>
              </Tabs>
            </TabsContent>
            <TabsContent value="skills" keepMounted className="flex min-h-0 flex-1 flex-col data-[hidden]:hidden">
              <SkillsTab query={queries.skills} ready={ready} onOpenPlugin={setSelected} />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  )
}
