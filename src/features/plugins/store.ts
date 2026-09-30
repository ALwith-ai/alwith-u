// Plugins & marketplace state, shaped after the official Codex app's local plugins page:
// the catalog (`plugin/list`: marketplaces + featured ids), the installed set
// (`plugin/installed`, newest first), skills (`skills/list`), and the actions the page runs.
// Every action talks to Codex through the client and re-reads the catalogs afterwards, the
// way the official page invalidates its queries.
import { toast } from "sonner"
import { createStore, type StoreApi } from "zustand/vanilla"
import type {
  MarketplaceAddParams,
  MarketplaceAddResponse,
  MarketplaceLoadErrorInfo,
  MarketplaceUpgradeResponse,
  PluginDetail,
  PluginInstalledResponse,
  PluginInstallParams,
  PluginInstallResponse,
  PluginListParams,
  PluginListResponse,
  PluginMarketplaceEntry,
  PluginReadParams,
  PluginReadResponse,
  PluginSummary,
  SkillErrorInfo,
  SkillMetadata,
  SkillsConfigWriteParams,
  SkillsConfigWriteResponse,
  SkillsListResponse
} from "@/agent/codex-extensions"
import i18n from "@/lib/i18n"

/** The client methods the store needs; tests pass a fake. */
export type PluginsApi = {
  listSkills(cwds?: string[], forceReload?: boolean): Promise<SkillsListResponse>
  setSkillEnabled(params: SkillsConfigWriteParams): Promise<SkillsConfigWriteResponse>
  listPlugins(params?: PluginListParams): Promise<PluginListResponse>
  installedPlugins(cwds?: string[]): Promise<PluginInstalledResponse>
  installPlugin(params: PluginInstallParams): Promise<PluginInstallResponse>
  uninstallPlugin(pluginId: string): Promise<void>
  readPlugin(params: PluginReadParams): Promise<PluginReadResponse>
  addMarketplace(params: MarketplaceAddParams): Promise<MarketplaceAddResponse>
  removeMarketplace(marketplaceName: string): Promise<void>
  upgradeMarketplaces(marketplaceName?: string): Promise<MarketplaceUpgradeResponse>
}

/** A plugin together with the marketplace it was listed under (needed to install and read). */
export type PluginEntry = { plugin: PluginSummary; marketplace: PluginMarketplaceEntry }

export type PluginsState = {
  loading: boolean
  /** Message of the last failed catalog load; the page shows a retry. */
  error: string | null
  /** Working directories the last refresh was scoped to (repo skills and marketplaces). */
  cwds: string[]
  marketplaces: PluginMarketplaceEntry[]
  marketplaceLoadErrors: MarketplaceLoadErrorInfo[]
  /** Ids the remote catalog features (the "Recommended" section). */
  featuredPluginIds: string[]
  /** Plugins Codex reports as installed, newest install first (`plugin/installed`). */
  installed: PluginEntry[]
  skills: SkillMetadata[]
  skillErrors: SkillErrorInfo[]
  /** Plugin ids with an install or uninstall in flight. */
  busyIds: Record<string, "installing" | "uninstalling">
  /** Marketplace names with an upgrade or removal in flight. */
  busyMarketplaces: Record<string, true>
  refresh(cwds?: string[], options?: { forceRefetch?: boolean }): Promise<void>
  /** Installs and returns Codex's answer (apps that still need auth); throws on failure. */
  install(entry: PluginEntry): Promise<PluginInstallResponse>
  uninstall(plugin: PluginSummary): Promise<void>
  readPlugin(entry: PluginEntry): Promise<PluginDetail>
  setSkillEnabled(skill: SkillMetadata, enabled: boolean): Promise<void>
  addMarketplace(params: MarketplaceAddParams): Promise<MarketplaceAddResponse>
  removeMarketplace(marketplaceName: string): Promise<void>
  upgradeMarketplace(marketplaceName: string): Promise<void>
  upgradeAll(): Promise<void>
}

export type PluginsStore = StoreApi<PluginsState>

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function pluginTitle(plugin: PluginSummary): string {
  return plugin.interface?.displayName ?? plugin.name
}

/** Skills for several cwds overlap (user and system scopes repeat); one row per path. */
export function mergeSkills(response: SkillsListResponse): { skills: SkillMetadata[]; errors: SkillErrorInfo[] } {
  const byPath = new Map<string, SkillMetadata>()
  const errors = new Map<string, SkillErrorInfo>()
  for (const entry of response.data) {
    for (const skill of entry.skills) byPath.set(skill.path, skill)
    for (const error of entry.errors) errors.set(error.path, error)
  }
  return { skills: [...byPath.values()], errors: [...errors.values()] }
}

/** Installed plugins across marketplaces, newest install first, as the official Manage tab sorts. */
export function installedEntries(response: PluginInstalledResponse): PluginEntry[] {
  const entries: PluginEntry[] = []
  for (const marketplace of response.marketplaces) {
    for (const plugin of marketplace.plugins) if (plugin.installed) entries.push({ plugin, marketplace })
  }
  return entries.sort((a, b) => (b.plugin.installedAt ?? 0) - (a.plugin.installedAt ?? 0))
}

/** Where Codex should install from: the local marketplace file, else the remote catalog by name. */
export function installParams(entry: PluginEntry): PluginInstallParams {
  const { plugin, marketplace } = entry
  return {
    installAttemptId: crypto.randomUUID(),
    pluginName: plugin.name,
    ...(marketplace.path === null ? { remoteMarketplaceName: marketplace.name } : { marketplacePath: marketplace.path })
  }
}

export function readParams(entry: PluginEntry): PluginReadParams {
  const { plugin, marketplace } = entry
  return {
    pluginName: plugin.name,
    ...(marketplace.path === null ? { remoteMarketplaceName: marketplace.name } : { marketplacePath: marketplace.path })
  }
}

export function createPluginsStore(api: PluginsApi): PluginsStore {
  const store = createStore<PluginsState>((set, get) => {
    const busy = (id: string, state: "installing" | "uninstalling" | null) =>
      set(current => {
        const next = { ...current.busyIds }
        if (state === null) delete next[id]
        else next[id] = state
        return { busyIds: next }
      })
    const busyMarketplace = (name: string, on: boolean) =>
      set(current => {
        const next = { ...current.busyMarketplaces }
        if (on) next[name] = true
        else delete next[name]
        return { busyMarketplaces: next }
      })

    return {
      loading: false,
      error: null,
      cwds: [],
      marketplaces: [],
      marketplaceLoadErrors: [],
      featuredPluginIds: [],
      installed: [],
      skills: [],
      skillErrors: [],
      busyIds: {},
      busyMarketplaces: {},

      refresh: async (cwds = get().cwds, options = {}) => {
        set({ loading: true, error: null, cwds })
        try {
          const [skills, plugins, installed] = await Promise.all([
            api.listSkills(cwds, options.forceRefetch),
            api.listPlugins({
              ...(cwds.length > 0 ? { cwds } : {}),
              ...(options.forceRefetch ? { forceRefetch: true } : {})
            }),
            api.installedPlugins(cwds)
          ])
          const merged = mergeSkills(skills)
          set({
            loading: false,
            skills: merged.skills,
            skillErrors: merged.errors,
            marketplaces: plugins.marketplaces,
            marketplaceLoadErrors: plugins.marketplaceLoadErrors,
            featuredPluginIds: plugins.featuredPluginIds,
            installed: installedEntries(installed)
          })
        } catch (error) {
          set({ loading: false, error: describe(error) })
        }
      },

      install: async entry => {
        const name = pluginTitle(entry.plugin)
        busy(entry.plugin.id, "installing")
        try {
          const response = await api.installPlugin(installParams(entry))
          toast.success(i18n.t("plugins.toast.installed", { pluginName: name }))
          await get().refresh()
          return response
        } catch (error) {
          toast.error(`${i18n.t("plugins.toast.installError")}: ${describe(error)}`)
          throw error
        } finally {
          busy(entry.plugin.id, null)
        }
      },

      uninstall: async plugin => {
        const name = pluginTitle(plugin)
        busy(plugin.id, "uninstalling")
        try {
          await api.uninstallPlugin(plugin.id)
          toast.success(i18n.t("plugins.toast.uninstalled", { pluginName: name }))
          await get().refresh()
        } catch (error) {
          toast.error(`${i18n.t("plugins.toast.uninstallError")}: ${describe(error)}`)
        } finally {
          busy(plugin.id, null)
        }
      },

      readPlugin: async entry => (await api.readPlugin(readParams(entry))).plugin,

      setSkillEnabled: async (skill, enabled) => {
        // Optimistic: the switch reflects the request; Codex answers with the effective state.
        set(state => ({ skills: state.skills.map(item => (item.path === skill.path ? { ...item, enabled } : item)) }))
        const name = skill.interface?.displayName ?? skill.name
        try {
          const response = await api.setSkillEnabled({ path: skill.path, enabled })
          set(state => ({
            skills: state.skills.map(item =>
              item.path === skill.path ? { ...item, enabled: response.effectiveEnabled } : item
            )
          }))
          toast.success(
            i18n.t(enabled ? "plugins.skills.enabledToast" : "plugins.skills.disabledToast", { skillName: name })
          )
        } catch (error) {
          set(state => ({
            skills: state.skills.map(item => (item.path === skill.path ? { ...item, enabled: !enabled } : item))
          }))
          toast.error(`${i18n.t("plugins.skills.toggleError")}: ${describe(error)}`)
        }
      },

      addMarketplace: async params => {
        const response = await api.addMarketplace(params)
        if (response.alreadyAdded) {
          toast.message(i18n.t("plugins.marketplace.alreadyAdded", { marketplaceName: response.marketplaceName }))
        } else {
          toast.success(i18n.t("plugins.marketplace.added", { marketplaceName: response.marketplaceName }))
        }
        await get().refresh(undefined, { forceRefetch: true })
        return response
      },

      removeMarketplace: async marketplaceName => {
        busyMarketplace(marketplaceName, true)
        try {
          await api.removeMarketplace(marketplaceName)
          toast.success(i18n.t("plugins.marketplace.removed", { marketplaceName }))
          await get().refresh()
        } catch (error) {
          toast.error(`${i18n.t("plugins.marketplace.removeError")}: ${describe(error)}`)
        } finally {
          busyMarketplace(marketplaceName, false)
        }
      },

      upgradeMarketplace: async marketplaceName => {
        busyMarketplace(marketplaceName, true)
        try {
          const response = await api.upgradeMarketplaces(marketplaceName)
          if (response.errors.length > 0) {
            toast.error(
              `${i18n.t("plugins.marketplace.upgradeError")}: ${response.errors.map(failure => failure.message).join("; ")}`
            )
          } else {
            toast.success(i18n.t("plugins.marketplace.upgraded", { marketplaceName }))
          }
          await get().refresh(undefined, { forceRefetch: true })
        } catch (error) {
          toast.error(`${i18n.t("plugins.marketplace.upgradeError")}: ${describe(error)}`)
        } finally {
          busyMarketplace(marketplaceName, false)
        }
      },

      upgradeAll: async () => {
        set({ loading: true })
        try {
          const response = await api.upgradeMarketplaces()
          if (response.errors.length > 0) toast.error(i18n.t("plugins.marketplace.upgradeAllError"))
          else toast.success(i18n.t("plugins.marketplace.upgradedAll"))
          await get().refresh(undefined, { forceRefetch: true })
        } catch (error) {
          set({ loading: false })
          toast.error(`${i18n.t("plugins.marketplace.upgradeAllRequestError")}: ${describe(error)}`)
        }
      }
    }
  })
  return store
}
