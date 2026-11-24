import type { PluginMarketplaceEntry, PluginSummary } from "@alwith/module-chat/client"
import { hasPluginStore } from "@alwith/module-chat/client"
import { MENU_HIGHLIGHT, NavigationItemButton, NavigationStack } from "@alwith/module-chat/session-list"
// Browse and manage Codex plugins and skills from one catalog surface.
import {
  BlocksIcon,
  BookOpenIcon,
  CheckIcon,
  CircleArrowUpIcon,
  MoreVerticalIcon,
  PlusIcon,
  PuzzleIcon,
  RefreshCwIcon,
  SearchIcon,
  Trash2Icon,
  XIcon
} from "lucide-react"
import { memo, type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useStore } from "zustand"

import { CatalogHeader } from "@/components/alwith-ui/catalog-header"
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
import { toolboxContentClassName, ToolboxPageHeader } from "@/components/alwith-ui/toolbox-layout"
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
import { newChatDirectory } from "@/features/chat/new-chat-directory"
import { client, useApp } from "@/lib/client"

import { CatalogSkeleton } from "./catalog-skeleton"
import { pluginsStore } from "./instance"
import { PluginDetailPage } from "./plugin-detail-page"
import { PluginIcon, PluginIconDefinitions } from "./plugin-icon"
import { traceCatalog } from "./request-cache"
import { SkillsTab } from "./skills-tab"
import type { PluginEntry } from "./store"

function pluginTitle(plugin: PluginSummary): string {
  return plugin.interface?.displayName ?? plugin.name
}

function pluginDescription(plugin: PluginSummary): string {
  return plugin.interface?.shortDescription ?? ""
}

/** Install action, installing spinner, or installed status matching the skills catalog. */
function PluginActionButton({ plugin, marketplace }: { plugin: PluginSummary; marketplace: PluginMarketplaceEntry }) {
  const { t } = useTranslation()
  const installing = useStore(pluginsStore, (state) => plugin.id in state.busyIds)
  const installed = useStore(pluginsStore, (state) => state.installed.some((entry) => entry.plugin.id === plugin.id))
  const install = useStore(pluginsStore, (state) => state.install)
  const unavailable = plugin.availability !== "AVAILABLE" || plugin.installPolicy === "NOT_AVAILABLE"
  const label = t(
    installing ? "plugins.card.installing" : installed ? "plugins.sections.installed" : "plugins.card.install"
  )
  if (installed && !installing) {
    return <CheckIcon className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} aria-label={label} />
  }
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      className="shrink-0 text-foreground"
      disabled={installing || installed || unavailable}
      aria-label={label}
      title={unavailable ? t("plugins.disabledReason.unknown") : label}
      onClick={() => void install({ plugin, marketplace }).catch(() => {})}
    >
      {installing ? <Spinner aria-hidden="true" /> : <PlusIcon className="size-4" strokeWidth={2} aria-hidden="true" />}
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
  return (
    <PanelItem className="toolbox-row relative">
      <Button
        variant="ghost"
        className="absolute inset-0 z-0 size-full"
        data-hover-background="none"
        aria-label={pluginTitle(plugin)}
        onClick={() => onOpen({ plugin, marketplace })}
      />
      <ItemMedia className="pointer-events-none relative translate-none! self-center!">
        <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-background">
          <PluginIcon name={plugin.name} info={plugin.interface} className="size-full object-contain" />
        </div>
      </ItemMedia>
      <ItemContent className="pointer-events-none relative min-w-0">
        <PanelItemTitle className="mb-0.5">{pluginTitle(plugin)}</PanelItemTitle>
        <ItemDescription className="line-clamp-1" title={description}>
          {description || marketplace.interface?.displayName || marketplace.name}
        </ItemDescription>
      </ItemContent>
      <ItemActions className="relative w-8 shrink-0 justify-center">{actions}</ItemActions>
    </PanelItem>
  )
}

/** Catalog data comes from Codex: until the engine is connected the page is loading. */
function usePluginsReady(): boolean {
  return useApp((state) => state.connection === "ready" && hasPluginStore(state.agent))
}

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

  if (plugins.length === 0) return null
  return (
    <section key={marketplace.name} className="flex flex-col gap-4">
      <div className="flex items-center gap-2 pe-3">
        <h2 className="text-base font-medium">{marketplace.interface?.displayName ?? marketplace.name}</h2>
        <span className="text-xs text-muted-foreground">{plugins.length}</span>
        {marketplace.path !== null && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="ms-auto text-muted-foreground"
                  aria-label={t("plugins.pageActions")}
                />
              }
            >
              <MoreVerticalIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-max min-w-[140px] whitespace-nowrap">
              <DropdownMenuItem className="text-destructive" onClick={() => void removeMarketplace(marketplace.name)}>
                <Trash2Icon className="size-3.5" />
                {t("plugins.marketplace.remove")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <PanelList className="grid grid-cols-1 gap-x-8 gap-y-2 px-0 @min-[700px]:grid-cols-2">
        {plugins.map((plugin) => (
          <PluginRow
            onOpen={onOpen}
            key={plugin.remotePluginId ?? plugin.id}
            plugin={plugin}
            marketplace={marketplace}
            actions={<PluginActionButton plugin={plugin} marketplace={marketplace} />}
          />
        ))}
      </PanelList>
    </section>
  )
}

const MarketplaceResults = memo(function MarketplaceResults({
  query,
  active,
  onOpen
}: {
  query: string
  active: boolean
  onOpen: (entry: PluginEntry) => void
}) {
  const { t } = useTranslation()
  const marketplaces = useStore(pluginsStore, (state) => state.marketplaces)
  const catalog = useStore(pluginsStore, (state) => state.catalog)
  const { entries, query: selectedQuery, loading, error, nextCursor, loadMore, retry } = useStore(catalog)
  const current = selectedQuery === query
  const sentinel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = sentinel.current
    if (!element || !active || !current || loading || error || nextCursor === null) return
    let requested = false
    const observer = new IntersectionObserver((observations) => {
      if (requested || !observations.some((entry) => entry.isIntersecting)) return
      requested = true
      void loadMore()
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [active, current, loading, error, nextCursor, loadMore])
  const sections = useMemo(() => {
    const groups = new Map<string, { marketplace: PluginMarketplaceEntry; plugins: PluginSummary[] }>()
    const term = query.toLowerCase()
    for (const marketplace of marketplaces)
      groups.set(JSON.stringify([marketplace.name, marketplace.path]), {
        marketplace,
        plugins: marketplace.plugins.filter(
          (plugin) =>
            !term ||
            [
              plugin.name,
              pluginTitle(plugin),
              pluginDescription(plugin),
              plugin.interface?.developerName ?? "",
              ...plugin.keywords
            ]
              .join("\n")
              .toLowerCase()
              .includes(term)
        )
      })
    if (current)
      for (const { plugin, marketplaceName, marketplacePath } of entries) {
        const key = JSON.stringify([marketplaceName, marketplacePath])
        const group = groups.get(key) ?? {
          marketplace: marketplaces.find(
            (marketplace) => marketplace.name === marketplaceName && marketplace.path === marketplacePath
          ) ?? { name: marketplaceName, path: marketplacePath, interface: null, plugins: [] },
          plugins: []
        }
        group.plugins.push(plugin)
        groups.set(key, group)
      }
    return [...groups.values()]
  }, [marketplaces, entries, current, query])
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
      {(loading || !current) && <CatalogSkeleton />}
      {current && error && (
        <div role="alert" className="flex items-center justify-between gap-2 px-2 text-sm text-destructive">
          <p>{error}</p>
          <Button variant="outline" size="sm" disabled={loading} onClick={() => void retry()}>
            {t("plugins.loadError.retry")}
          </Button>
        </div>
      )}
      {current && !loading && !error && sections.every((section) => section.plugins.length === 0) && (
        <p className="px-2 py-6 text-center text-sm text-muted-foreground">{t("plugins.empty")}</p>
      )}
      <div ref={sentinel} className="h-px" aria-hidden="true" />
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
        className="h-9"
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
        <DialogTrigger render={<Button size="sm" className="h-9" variant="outline" disabled={!ready} />}>
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

function MarketplaceTab({
  onOpen,
  query,
  active
}: {
  onOpen: (entry: PluginEntry) => void
  query: string
  active: boolean
}) {
  const ready = usePluginsReady()
  const loadErrors = useStore(pluginsStore, (state) => state.marketplaceLoadErrors)
  const loading = useStore(pluginsStore, (state) => state.pluginsLoading && state.marketplaces.length === 0) || !ready
  const catalog = useStore(pluginsStore, (state) => state.catalog)
  const revision = useStore(catalog, (state) => state.revision)
  const scope = useStore(pluginsStore, (state) => JSON.stringify(state.cwds))
  const [q, setQuery] = useState(query.trim())
  useEffect(() => {
    const timer = setTimeout(() => setQuery(query.trim()), 200)
    return () => clearTimeout(timer)
  }, [query])
  useEffect(() => {
    if (active && ready) void catalog.getState().load(q, JSON.parse(scope) as string[])
  }, [active, ready, catalog, q, scope, revision])
  return (
    <Pane className="pe-0" viewportClassName="pe-0">
      <div className={`${toolboxContentClassName} flex flex-col gap-8`}>
        {loadErrors.map((error) => (
          <p key={error.marketplacePath} className="px-2 text-xs text-destructive">
            {error.marketplacePath}: {error.message}
          </p>
        ))}
        {loading ? <CatalogSkeleton /> : <MarketplaceResults query={q} active={active} onOpen={onOpen} />}
      </div>
    </Pane>
  )
}

/** Catalogs load the current project first; other skill projects are discovered in the background. */
export function PluginsPage({
  cwd,
  active,
  extensions,
  onOpenCatalog
}: {
  cwd: string | null
  active: boolean
  onOpenCatalog?: () => void
  extensions?: {
    active: boolean
    onOpen: () => void
    content: ReactNode
  }
}) {
  const { t } = useTranslation()
  const refresh = useStore(pluginsStore, (state) => state.refresh)
  const skillsError = useStore(pluginsStore, (state) => state.skillsError)
  const pluginsError = useStore(pluginsStore, (state) => state.pluginsError)
  const installedError = useStore(pluginsStore, (state) => state.installedError)
  const installedLoading = useStore(pluginsStore, (state) => state.installedLoading)
  const [kind, setKind] = useState("plugins")
  const loading = useStore(pluginsStore, (state) => (kind === "skills" ? state.skillsLoading : state.pluginsLoading))
  const [queries, setQueries] = useState({ plugins: "", skills: "" })
  const error = kind === "skills" ? skillsError : pluginsError
  const query = kind === "skills" ? queries.skills : queries.plugins
  const setQuery = (value: string) => setQueries((current) => ({ ...current, [kind]: value }))
  const sessionRows = useApp((state) => state.sessionList)
  const projectContext = useApp((state) => state.projectContext)
  // Runtime traffic must not rescan history while this offscreen catalog stays mounted.
  const knownDirectories = useMemo(
    () =>
      JSON.stringify(
        [...new Set(sessionRows.map((row) => row.cwd))]
          .map((cwd) => newChatDirectory(cwd, projectContext))
          .filter((path): path is string => path !== null)
          .toSorted()
      ),
    [sessionRows, projectContext]
  )
  const directory = useMemo(() => newChatDirectory(cwd, projectContext), [cwd, projectContext])
  const directoriesKey = JSON.stringify(directory === null ? [] : [directory])
  const installed = useStore(pluginsStore, (state) => state.installed)
  // Official catalogs and policy installations do not belong in the personal installed list.
  const personalInstalled = installed.filter(
    ({ plugin, marketplace }) =>
      marketplace.name !== "openai" &&
      !marketplace.name.startsWith("openai-") &&
      plugin.installPolicy !== "INSTALLED_BY_DEFAULT" &&
      plugin.installPolicySource !== "IMPLICIT_CANONICAL_APP"
  )
  const searchLabel = t(kind === "skills" ? "plugins.skills.search" : "plugins.search")
  const [selected, setSelected] = useState<PluginEntry | null>(null)
  const ready = usePluginsReady()
  const skillsLoading = useStore(pluginsStore, (state) => state.skillsLoading)

  useEffect(() => {
    if (!ready) pluginsStore.getState().invalidate()
  }, [ready])

  const resources = extensions?.active || selected ? "installed" : kind === "skills" ? "skills" : "all"
  const skillsActive = active && resources === "skills"

  useEffect(() => {
    traceCatalog(`page active=${active} ready=${ready}`)
    // The screen arrow is available even before the engine has connected.
    if (!active || !ready) return
    if (pluginsStore.getState().loadedScope !== directoriesKey)
      void refresh(JSON.parse(directoriesKey) as string[], {
        cached: true,
        resources
      })
  }, [active, ready, refresh, directoriesKey, resources])

  useEffect(() => {
    if (!ready) return
    return client.onSkillsChanged(() => void pluginsStore.getState().skillsChanged())
  }, [ready, refresh])

  useEffect(() => {
    if (!skillsActive || !ready || skillsLoading) return
    const controller = new AbortController()
    void pluginsStore.getState().discoverSkillProjects(JSON.parse(knownDirectories) as string[], controller.signal)
    return () => controller.abort()
  }, [skillsActive, ready, skillsLoading, knownDirectories, directoriesKey])

  const openPlugin = (entry: PluginEntry) => {
    onOpenCatalog?.()
    setKind("plugins")
    setSelected(entry)
  }
  const showCatalog = (value: string) => {
    onOpenCatalog?.()
    setKind(value)
    setSelected(null)
  }

  return (
    <div className="@container flex h-full min-h-0 overflow-hidden [--navigation-row-height:30px] [--spacing:4px]">
      <PluginIconDefinitions />
      <aside
        className="flex w-44 shrink-0 flex-col border-e bg-sidebar/40 sm:w-60"
        aria-label={t("plugins.catalog.navigation")}
      >
        <div className="shrink-0 px-3 pt-3">
          <div className="flex h-9 items-center" data-plugin-sidebar-header="">
            <h2 className="text-sm leading-8 font-semibold">{t("plugins.catalog.customize")}</h2>
          </div>
        </div>
        <nav aria-label={t("plugins.manageTabs.aria")} className="flex shrink-0 flex-col gap-1 px-2 pb-1">
          {extensions && (
            <NavigationItemButton
              className={`${MENU_HIGHLIGHT} h-8 gap-2 px-2`}
              active={extensions.active}
              onClick={extensions.onOpen}
            >
              <BlocksIcon className="size-4" />
              <span>{t("sidebar.extensions")}</span>
            </NavigationItemButton>
          )}
          {(["plugins", "skills"] as const).map((value) => (
            <NavigationItemButton
              key={value}
              className={`${MENU_HIGHLIGHT} h-8 gap-2 px-2`}
              active={!extensions?.active && kind === value && selected === null}
              onClick={() => showCatalog(value)}
            >
              {value === "plugins" ? <PuzzleIcon className="size-4" /> : <BookOpenIcon className="size-4" />}
              <span>{t(`plugins.headings.${value}`)}</span>
            </NavigationItemButton>
          ))}
        </nav>
        <h3 className="mx-2 mt-1 mb-2 flex h-8 shrink-0 items-center px-2 text-xs font-medium text-muted-foreground">
          {t("plugins.sections.installed")}
        </h3>
        <Pane className="min-h-0 flex-1 pe-0" viewportClassName="pe-0">
          <nav aria-label={t("plugins.sections.installed")} className="px-2 pb-4">
            <NavigationStack>
              {!ready || (installedLoading && personalInstalled.length === 0) ? (
                <div role="status" className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                  <Spinner className="size-3.5" role="presentation" aria-hidden="true" />
                  {t("plugins.detail.loading")}
                </div>
              ) : installedError ? (
                <p role="alert" className="px-3 py-2 text-xs text-destructive">
                  {installedError}
                </p>
              ) : personalInstalled.length === 0 ? (
                <p className="px-3 py-2 text-xs text-muted-foreground">{t("plugins.sections.installedEmpty")}</p>
              ) : (
                personalInstalled.map((entry) => (
                  <NavigationItemButton
                    key={entry.plugin.id}
                    title={pluginTitle(entry.plugin)}
                    className={`${MENU_HIGHLIGHT} gap-2 px-2`}
                    active={!extensions?.active && selected?.plugin.id === entry.plugin.id}
                    onClick={() => openPlugin(entry)}
                  >
                    <PluginIcon name={entry.plugin.name} info={entry.plugin.interface} className="size-4 shrink-0" />
                    <span className="truncate">{pluginTitle(entry.plugin)}</span>
                  </NavigationItemButton>
                ))
              )}
            </NavigationStack>
          </nav>
        </Pane>
      </aside>
      <main
        className="toolbox-surface @container flex min-h-0 min-w-0 flex-1 flex-col"
        aria-label={t("plugins.catalog.content")}
      >
        {extensions?.active ? (
          extensions.content
        ) : (
          <>
            {selected && (
              <PluginDetailPage
                key={JSON.stringify([selected.marketplace.name, selected.marketplace.path, selected.plugin.id, cwd])}
                entry={selected}
                onBack={() => showCatalog("plugins")}
              />
            )}
            <div hidden={selected !== null} className={selected ? "hidden" : "flex min-h-0 flex-1 flex-col"}>
              <ToolboxPageHeader>
                <CatalogHeader title={t(`plugins.headings.${kind}`)}>
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <div className="relative w-52 max-w-full">
                      <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        className="h-9 rounded-full ps-9 pe-9"
                        aria-label={searchLabel}
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder={searchLabel}
                      />
                      {query && (
                        <Button
                          className="toolbox-search-clear absolute end-1 top-1/2 -translate-y-1/2"
                          variant="ghost"
                          size="icon-xs"
                          aria-label={t("plugins.catalog.clearSearch")}
                          onClick={() => setQuery("")}
                        >
                          <XIcon />
                        </Button>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground"
                      aria-label={t("plugins.skills.refresh")}
                      disabled={!ready || loading}
                      onClick={() =>
                        void refresh(undefined, {
                          forceRefetch: true,
                          resources
                        })
                      }
                    >
                      {loading ? <Spinner /> : <RefreshCwIcon />}
                    </Button>
                    {kind === "plugins" && <PluginToolbar />}
                  </div>
                </CatalogHeader>
              </ToolboxPageHeader>
              {(kind === "plugins" || error) && (
                <div className="toolbox-content flex shrink-0 flex-col gap-4 pt-2 pb-6">
                  {kind === "plugins" && (
                    <>
                      <p className="text-sm text-muted-foreground">{t("plugins.catalog.description")}</p>
                    </>
                  )}
                  {error && (
                    <div role="alert" className="flex items-center justify-between gap-2 text-sm text-destructive">
                      <p>
                        {t("plugins.loadError.title")}: {error}
                      </p>
                      <Button
                        size="sm"
                        className="h-9"
                        variant="outline"
                        disabled={loading || !ready}
                        onClick={() => void refresh(undefined, { resources })}
                      >
                        {t("plugins.loadError.retry")}
                      </Button>
                    </div>
                  )}
                </div>
              )}
              <div className="flex min-h-0 flex-1 flex-col">
                <div
                  hidden={kind !== "plugins"}
                  className={kind === "plugins" ? "flex min-h-0 flex-1 flex-col" : "hidden"}
                >
                  <MarketplaceTab
                    query={queries.plugins}
                    onOpen={openPlugin}
                    active={active && !extensions?.active && kind === "plugins" && selected === null}
                  />
                </div>
                <div
                  hidden={kind !== "skills"}
                  className={kind === "skills" ? "flex min-h-0 flex-1 flex-col" : "hidden"}
                >
                  <SkillsTab query={queries.skills} ready={ready} />
                </div>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
