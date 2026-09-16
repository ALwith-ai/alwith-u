// The official "Plugins" browse page for the Local host: heading + subtitle, search, Manage,
// page actions; then the sections the official store page renders — Recommended (the
// catalog's featured ids), Installed (newest first, with a Manage link) and one section per
// marketplace — each showing 6 cards with "See {names}, and more" to expand.
import { MoreHorizontalIcon, SearchIcon } from "lucide-react"
import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useStore } from "zustand"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Skeleton } from "@/components/ui/skeleton"
import { pluginsStore } from "./instance"
import { PluginCard } from "./plugin-card"
import { type PluginEntry, catalogEntries, pluginDescription, pluginTitle } from "./store"

const SECTION_LIMIT = 6

export function matchesQuery(entry: PluginEntry, q: string): boolean {
  if (q === "") return true
  const { plugin } = entry
  return [pluginTitle(plugin), pluginDescription(plugin), plugin.interface?.developerName ?? "", ...plugin.keywords].some(
    text => text.toLowerCase().includes(q)
  )
}

function PluginSection({
  id,
  title,
  entries,
  action,
  ...handlers
}: {
  id: string
  title: string
  entries: PluginEntry[]
  action?: React.ReactNode
  installedIds: Set<string>
  onOpen: (entry: PluginEntry) => void
  onInstall: (entry: PluginEntry) => void
  onManage: () => void
  onUninstall: (entry: PluginEntry) => void
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  if (entries.length === 0) return null
  const visible = expanded ? entries : entries.slice(0, SECTION_LIMIT)
  const hidden = entries.slice(SECTION_LIMIT)
  return (
    <section id={id} className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {visible.map(entry => (
          <PluginCard
            key={`${entry.marketplace.name}:${entry.plugin.id}`}
            entry={entry}
            installed={handlers.installedIds.has(entry.plugin.id)}
            onOpen={() => handlers.onOpen(entry)}
            onInstall={() => handlers.onInstall(entry)}
            onManage={handlers.onManage}
            onUninstall={() => handlers.onUninstall(entry)}
          />
        ))}
      </div>
      {hidden.length > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground self-start"
          onClick={() => setExpanded(value => !value)}>
          {expanded
            ? t("plugins.sections.showLess")
            : t("plugins.sections.seeMoreDescription", {
                pluginNames: hidden
                  .slice(0, 3)
                  .map(entry => pluginTitle(entry.plugin))
                  .join(", ")
              })}
        </Button>
      )}
    </section>
  )
}

export function BrowsePage({
  onOpen,
  onInstall,
  onManage,
  onUninstall,
  onAddMarketplace
}: {
  onOpen: (entry: PluginEntry) => void
  onInstall: (entry: PluginEntry) => void
  onManage: () => void
  onUninstall: (entry: PluginEntry) => void
  onAddMarketplace: () => void
}) {
  const { t } = useTranslation()
  const marketplaces = useStore(pluginsStore, state => state.marketplaces)
  const featuredIds = useStore(pluginsStore, state => state.featuredPluginIds)
  const installed = useStore(pluginsStore, state => state.installed)
  const loading = useStore(pluginsStore, state => state.loading)
  const error = useStore(pluginsStore, state => state.error)
  const refresh = useStore(pluginsStore, state => state.refresh)
  const [query, setQuery] = useState("")
  const q = query.trim().toLowerCase()

  const installedIds = useMemo(() => new Set(installed.map(entry => entry.plugin.id)), [installed])
  const everything = useMemo(() => catalogEntries(marketplaces), [marketplaces])
  const featured = useMemo(() => {
    const byId = new Map(everything.map(entry => [entry.plugin.id, entry]))
    return featuredIds.flatMap(id => {
      const entry = byId.get(id)
      return entry ? [entry] : []
    })
  }, [everything, featuredIds])
  const results = useMemo(() => (q === "" ? [] : everything.filter(entry => matchesQuery(entry, q))), [everything, q])

  const handlers = { installedIds, onOpen, onInstall, onManage, onUninstall }
  const empty = !loading && everything.length === 0 && installed.length === 0

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <header className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold">{t("plugins.title")}</h1>
            <p className="text-muted-foreground text-sm">{t("plugins.subtitle")}</p>
          </div>
          <Button variant="outline" size="sm" onClick={onManage}>
            {t("plugins.manage")}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="icon-sm" aria-label={t("plugins.pageActions")} />}>
              <MoreHorizontalIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[180px]">
              <DropdownMenuItem onClick={onAddMarketplace}>{t("plugins.addMarketplace")}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            value={query}
            aria-label={t("plugins.search")}
            placeholder={t("plugins.search")}
            onChange={event => setQuery(event.target.value)}
          />
        </InputGroup>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto pb-6">
        {error !== null && (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t("plugins.loadError.title")}</EmptyTitle>
              <EmptyDescription className="font-mono">{error}</EmptyDescription>
            </EmptyHeader>
            <Button variant="outline" onClick={() => void refresh()}>
              {t("plugins.loadError.retry")}
            </Button>
          </Empty>
        )}
        {loading && everything.length === 0 && (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2" aria-label={t("plugins.loading")}>
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-20 rounded-xl" />
            ))}
          </div>
        )}
        {q !== "" ? (
          results.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>{t("plugins.empty")}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
            <PluginSection id="plugins-search" title={t("plugins.search")} entries={results} {...handlers} />
          )
        ) : (
          <>
            <PluginSection id="plugins-featured" title={t("plugins.sections.featured")} entries={featured} {...handlers} />
            <PluginSection
              id="plugins-connected"
              title={t("plugins.sections.installed")}
              entries={installed}
              action={
                <Button variant="link" size="sm" className="text-muted-foreground h-auto p-0" onClick={onManage}>
                  {t("plugins.manage")}
                </Button>
              }
              {...handlers}
            />
            {marketplaces.map(marketplace => (
              <PluginSection
                key={marketplace.name}
                id={`plugins-marketplace-${encodeURIComponent(marketplace.name)}`}
                title={marketplace.interface?.displayName ?? marketplace.name}
                entries={marketplace.plugins.map(plugin => ({ plugin, marketplace }))}
                {...handlers}
              />
            ))}
            {empty && error === null && (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>{t("plugins.empty")}</EmptyTitle>
                </EmptyHeader>
              </Empty>
            )}
          </>
        )}
      </div>
    </div>
  )
}
