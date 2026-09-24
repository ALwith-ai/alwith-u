import { convertFileSrc } from "@tauri-apps/api/core"
// Skills and plugins store, reduced from ALwith Desktop's extensions page: title + BETA,
// Marketplace / Installed tabs, PanelItem rows with icon box, title, description and
// the install / installing / installed action button. Data is Codex's own catalog
// (`_codex/plugin_*`, `_codex/skills_*`); Desktop's registry fetch, zip download progress
// and version-diff "update" state have no counterpart here and are dropped.
import { CircleArrowUpIcon, MoreVerticalIcon, PlusIcon, PuzzleIcon, SparklesIcon, Trash2Icon } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useStore } from "zustand"
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
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { PluginMarketplaceEntry, PluginSummary, SkillMetadata } from "@/agent/codex-extensions"
import { client } from "@/lib/client"
import { pluginsStore } from "./instance"

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
function IconBox({ src, fallback }: { src: string | null; fallback: "plugin" | "skill" }) {
  const Fallback = fallback === "plugin" ? PuzzleIcon : SparklesIcon
  return (
    <ItemMedia>
      <div className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-sm">
        {src ? (
          <img src={src} alt="" className="size-8 rounded-sm object-cover" />
        ) : (
          <Fallback className="text-muted-foreground size-5" />
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
      onClick={() => void install({ plugin, marketplace })}>
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
      <IconBox src={plugin.interface?.composerIconUrl ?? null} fallback="plugin" />
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

function matchesPlugin(plugin: PluginSummary, q: string): boolean {
  if (!q) return true
  const haystack = [
    pluginTitle(plugin),
    pluginDescription(plugin),
    plugin.interface?.developerName ?? "",
    ...plugin.keywords
  ]
  return haystack.some(text => text.toLowerCase().includes(q))
}

function MarketplaceTab() {
  const { t } = useTranslation()
  const marketplaces = useStore(pluginsStore, state => state.marketplaces)
  const loadErrors = useStore(pluginsStore, state => state.marketplaceLoadErrors)
  const featuredIds = useStore(pluginsStore, state => state.featuredPluginIds)
  const loading = useStore(pluginsStore, state => state.loading)
  const addMarketplace = useStore(pluginsStore, state => state.addMarketplace)
  const removeMarketplace = useStore(pluginsStore, state => state.removeMarketplace)
  const upgrade = useStore(pluginsStore, state => state.upgradeAll)
  const [query, setQuery] = useState("")
  const [source, setSource] = useState("")
  const q = query.trim().toLowerCase()

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
        {loading && <Spinner className="text-muted-foreground shrink-0" />}
        <Button size="sm" variant="outline" disabled={loading} onClick={() => void upgrade()}>
          <CircleArrowUpIcon data-icon="inline-start" />
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
          {loadErrors.map(error => (
            <p key={error.marketplacePath} className="text-destructive px-2 text-xs">
              {error.marketplacePath}: {error.message}
            </p>
          ))}
          {marketplaces.map(marketplace => {
            // The remote catalog holds thousands of entries; like the official client, show
            // its featured plugins until a search narrows the whole catalog.
            const remote = marketplace.path === null
            const plugins = marketplace.plugins.filter(plugin =>
              q === "" && remote ? featuredIds.includes(plugin.id) : matchesPlugin(plugin, q)
            )
            if (plugins.length === 0) return null
            return (
              <section key={marketplace.name} className="flex flex-col gap-1">
                <div className="flex items-center gap-2 px-2">
                  <h2 className="text-muted-foreground text-xs font-medium">
                    {marketplace.interface?.displayName ?? marketplace.name}
                  </h2>
                  <span className="text-muted-foreground text-xs opacity-60">{plugins.length}</span>
                  {marketplace.path !== null && (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="text-muted-foreground ms-auto"
                            aria-label={t("plugins.pageActions")}
                          />
                        }>
                        <MoreVerticalIcon />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-[140px]">
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => void removeMarketplace(marketplace.name)}>
                          <Trash2Icon className="me-2 size-3.5" />
                          {t("plugins.marketplace.remove")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
                <PanelList className="grid grid-cols-2 gap-2">
                  {plugins.map(plugin => (
                    <PluginRow
                      key={plugin.id}
                      plugin={plugin}
                      marketplace={marketplace}
                      actions={<PluginActionButton plugin={plugin} marketplace={marketplace} />}
                    />
                  ))}
                </PanelList>
              </section>
            )
          })}
          {!loading && marketplaces.every(marketplace => marketplace.plugins.length === 0) && (
            <p className="text-muted-foreground px-2 py-6 text-center text-sm">{t("plugins.empty")}</p>
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
      <IconBox src={skillIconSrc(skill)} fallback="skill" />
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
  const installed = useStore(pluginsStore, state => state.installed)
  const busyIds = useStore(pluginsStore, state => state.busyIds)
  const uninstall = useStore(pluginsStore, state => state.uninstall)
  const skills = useStore(pluginsStore, state => state.skills)
  const skillErrors = useStore(pluginsStore, state => state.skillErrors)
  return (
    <Pane>
      <div className="flex flex-col gap-4">
        <section className="flex flex-col gap-1">
          <h2 className="text-muted-foreground px-2 text-xs font-medium">{t("plugins.headings.plugins")}</h2>
          {installed.length === 0 ? (
            <p className="text-muted-foreground px-2 py-4 text-sm">{t("plugins.sections.installedEmpty")}</p>
          ) : (
            <PanelList className="grid grid-cols-2 gap-2">
              {installed.map(({ plugin, marketplace }) => (
                <PluginRow
                  key={plugin.id}
                  plugin={plugin}
                  marketplace={marketplace}
                  actions={
                    <>
                      {plugin.id in busyIds && <Spinner className="text-muted-foreground size-3.5" />}
                      {/* Codex has no plugin enable request; the state is shown, not switched. */}
                      <Badge variant={plugin.enabled ? "secondary" : "outline"} className="text-[10px]">
                        {t(plugin.enabled ? "plugins.card.enabledStatus" : "plugins.card.disabledStatus")}
                      </Badge>
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
          <h2 className="text-muted-foreground px-2 text-xs font-medium">{t("plugins.headings.skills")}</h2>
          {skillErrors.map(error => (
            <p key={error.path} className="text-destructive px-2 text-xs">
              {error.path}: {error.message}
            </p>
          ))}
          {skills.length === 0 ? (
            <p className="text-muted-foreground px-2 py-4 text-sm">{t("plugins.skills.empty")}</p>
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
export function PluginsPage({ cwd }: { cwd: string | null }) {
  const { t } = useTranslation()
  const refresh = useStore(pluginsStore, state => state.refresh)

  useEffect(() => {
    void refresh(cwd === null ? [] : [cwd])
    return client.onSkillsChanged(() => void refresh())
  }, [refresh, cwd])

  return (
    <div className="flex h-full flex-col overflow-hidden">
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
