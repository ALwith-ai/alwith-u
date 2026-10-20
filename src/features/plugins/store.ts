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
  setPluginEnabled(pluginId: string, enabled: boolean, remotePluginId?: string): Promise<{ enabled: boolean }>
  uninstallPlugin(pluginId: string): Promise<void>
  readPlugin(params: PluginReadParams): Promise<PluginReadResponse>
  addMarketplace(params: MarketplaceAddParams): Promise<MarketplaceAddResponse>
  removeMarketplace(marketplaceName: string): Promise<void>
  upgradeMarketplaces(marketplaceName?: string): Promise<MarketplaceUpgradeResponse>
}

/** A plugin together with the marketplace it was listed under (needed to install and read). */
export type PluginEntry = { plugin: PluginSummary; marketplace: PluginMarketplaceEntry }

type PluginsState = {
  loading: boolean
  upgrading: boolean
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
  /** Plugin ids with an install, uninstall or enablement change in flight. */
  busyIds: Record<string, "installing" | "uninstalling" | "toggling">
  /** Marketplace names with an upgrade or removal in flight. */
  busyMarketplaces: Record<string, true>
  refresh(cwds?: string[], options?: { forceRefetch?: boolean; background?: boolean }): Promise<void>
  /** Installs and returns Codex's answer (apps that still need auth); throws on failure. */
  install(entry: PluginEntry): Promise<PluginInstallResponse>
  setPluginEnabled(plugin: PluginSummary, enabled: boolean): Promise<void>
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

function pluginTitle(plugin: PluginSummary): string {
  return plugin.interface?.displayName ?? plugin.name
}

/** Skills for several cwds overlap (user and system scopes repeat); one row per path. */
function mergeSkills(response: SkillsListResponse): { skills: SkillMetadata[]; errors: SkillErrorInfo[] } {
  const byPath = new Map<string, SkillMetadata>()
  const errors = new Map<string, SkillErrorInfo>()
  for (const entry of response.data) {
    for (const skill of entry.skills) byPath.set(skill.path, skill)
    for (const error of entry.errors) errors.set(error.path, error)
  }
  return { skills: [...byPath.values()], errors: [...errors.values()] }
}

/** Installed plugins across marketplaces, newest install first, as the official Manage tab sorts. */
function installedEntries(response: PluginInstalledResponse): PluginEntry[] {
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
    pluginName: marketplace.path === null ? (plugin.remotePluginId ?? plugin.name) : plugin.name,
    ...(marketplace.path === null ? { remoteMarketplaceName: marketplace.name } : { marketplacePath: marketplace.path })
  }
}

function readParams(entry: PluginEntry): PluginReadParams {
  const { plugin, marketplace } = entry
  return {
    pluginName: marketplace.path === null ? (plugin.remotePluginId ?? plugin.name) : plugin.name,
    ...(marketplace.path === null ? { remoteMarketplaceName: marketplace.name } : { marketplacePath: marketplace.path })
  }
}

export function createPluginsStore(api: PluginsApi): PluginsStore {
  const store = createStore<PluginsState>((set, get) => {
    let pendingRefresh: { cwds: string[]; forceRefetch: boolean } | null = null
    let refreshing: Promise<void> | null = null
    const refreshAfterChange = async (forceRefetch = false) => {
      await get().refresh(undefined, { forceRefetch, background: true })
      if (get().error) throw new Error(i18n.t("plugins.toast.syncError", { message: get().error }))
    }
    const busy = (id: string, state: "installing" | "uninstalling" | "toggling" | null) =>
      set((current) => {
        const next = { ...current.busyIds }
        if (state === null) delete next[id]
        else next[id] = state
        return { busyIds: next }
      })
    const busyMarketplace = (name: string, on: boolean) =>
      set((current) => {
        const next = { ...current.busyMarketplaces }
        if (on) next[name] = true
        else delete next[name]
        return { busyMarketplaces: next }
      })

    return {
      loading: false,
      upgrading: false,
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

      refresh: (cwds = get().cwds, options = {}) => {
        pendingRefresh = { cwds, forceRefetch: options.forceRefetch === true || pendingRefresh?.forceRefetch === true }
        set({ cwds, ...(!options.background ? { loading: true } : {}) })
        if (refreshing) return refreshing
        refreshing = (async () => {
          while (pendingRefresh) {
            const request = pendingRefresh
            pendingRefresh = null
            set({ error: null })
            try {
              const [skills, plugins, installed] = await Promise.all([
                api.listSkills(request.cwds, request.forceRefetch),
                api.listPlugins({
                  ...(request.cwds.length > 0 ? { cwds: request.cwds } : {}),
                  ...(request.forceRefetch ? { forceRefetch: true } : {})
                }),
                api.installedPlugins(request.cwds)
              ])
              // A newer scope or invalidation must settle before exposing a snapshot.
              if (pendingRefresh) continue
              const merged = mergeSkills(skills)
              set({
                skills: merged.skills,
                skillErrors: merged.errors,
                marketplaces: plugins.marketplaces,
                marketplaceLoadErrors: plugins.marketplaceLoadErrors,
                featuredPluginIds: plugins.featuredPluginIds,
                installed: installedEntries(installed)
              })
            } catch (error) {
              if (!pendingRefresh) set({ error: describe(error) })
            }
          }
        })().finally(() => {
          refreshing = null
          set({ loading: false })
        })
        return refreshing
      },

      install: async (entry) => {
        if (entry.plugin.id in get().busyIds) throw new Error("Plugin operation already in progress")
        const name = pluginTitle(entry.plugin)
        busy(entry.plugin.id, "installing")
        try {
          const response = await api.installPlugin(installParams(entry))
          await refreshAfterChange()
          busy(entry.plugin.id, null)
          toast.success(i18n.t("plugins.toast.installed", { pluginName: name }))
          return response
        } catch (error) {
          toast.error(`${i18n.t("plugins.toast.installError")}: ${describe(error)}`)
          throw error
        } finally {
          busy(entry.plugin.id, null)
        }
      },

      setPluginEnabled: async (plugin, enabled) => {
        if (plugin.id in get().busyIds) return
        busy(plugin.id, "toggling")
        const update = (value: boolean) =>
          set((state) => ({
            installed: state.installed.map((entry) =>
              entry.plugin.id === plugin.id ? { ...entry, plugin: { ...entry.plugin, enabled: value } } : entry
            )
          }))
        update(enabled)
        let effectiveEnabled = plugin.enabled
        try {
          const remotePluginId = plugin.source.type === "remote" ? plugin.remotePluginId : undefined
          if (remotePluginId === null) throw new Error("Remote plugin ID is missing")
          const response = await api.setPluginEnabled(plugin.id, enabled, remotePluginId)
          effectiveEnabled = response.enabled
          update(response.enabled)
          await refreshAfterChange()
          const refreshed = get().installed.find((entry) => entry.plugin.id === plugin.id)
          if (refreshed) effectiveEnabled = refreshed.plugin.enabled
          if (!refreshed || effectiveEnabled !== enabled) {
            throw new Error(i18n.t("plugins.toast.toggleNotApplied"))
          }
          busy(plugin.id, null)
          toast.success(
            i18n.t(enabled ? "plugins.toast.enabled" : "plugins.toast.disabled", { pluginName: pluginTitle(plugin) })
          )
        } catch (error) {
          update(effectiveEnabled)
          toast.error(`${i18n.t("plugins.toast.toggleError")}: ${describe(error)}`)
        } finally {
          busy(plugin.id, null)
        }
      },

      uninstall: async (plugin) => {
        if (plugin.id in get().busyIds) return
        const name = pluginTitle(plugin)
        busy(plugin.id, "uninstalling")
        try {
          const uninstallId = plugin.source.type === "remote" ? plugin.remotePluginId : plugin.id
          if (!uninstallId) throw new Error("Remote plugin ID is missing")
          await api.uninstallPlugin(uninstallId)
          await refreshAfterChange()
          if (get().installed.some((entry) => entry.plugin.id === plugin.id)) {
            throw new Error(i18n.t("plugins.toast.uninstallNotApplied"))
          }
          busy(plugin.id, null)
          toast.success(i18n.t("plugins.toast.uninstalled", { pluginName: name }))
        } catch (error) {
          toast.error(`${i18n.t("plugins.toast.uninstallError")}: ${describe(error)}`)
        } finally {
          busy(plugin.id, null)
        }
      },

      readPlugin: async (entry) => (await api.readPlugin(readParams(entry))).plugin,

      setSkillEnabled: async (skill, enabled) => {
        // Optimistic: the switch reflects the request; Codex answers with the effective state.
        set((state) => ({
          skills: state.skills.map((item) => (item.path === skill.path ? { ...item, enabled } : item))
        }))
        const name = skill.interface?.displayName ?? skill.name
        try {
          const response = await api.setSkillEnabled({ path: skill.path, enabled })
          set((state) => ({
            skills: state.skills.map((item) =>
              item.path === skill.path ? { ...item, enabled: response.effectiveEnabled } : item
            )
          }))
          toast.success(
            i18n.t(enabled ? "plugins.skills.enabledToast" : "plugins.skills.disabledToast", { skillName: name })
          )
        } catch (error) {
          set((state) => ({
            skills: state.skills.map((item) => (item.path === skill.path ? { ...item, enabled: !enabled } : item))
          }))
          toast.error(`${i18n.t("plugins.skills.toggleError")}: ${describe(error)}`)
        }
      },

      addMarketplace: async (params) => {
        const response = await api.addMarketplace(params)
        await refreshAfterChange(true)
        if (response.alreadyAdded) {
          toast.message(i18n.t("plugins.marketplace.alreadyAdded", { marketplaceName: response.marketplaceName }))
        } else {
          toast.success(i18n.t("plugins.marketplace.added", { marketplaceName: response.marketplaceName }))
        }
        return response
      },

      removeMarketplace: async (marketplaceName) => {
        busyMarketplace(marketplaceName, true)
        try {
          await api.removeMarketplace(marketplaceName)
          await refreshAfterChange()
          busyMarketplace(marketplaceName, false)
          toast.success(i18n.t("plugins.marketplace.removed", { marketplaceName }))
        } catch (error) {
          toast.error(`${i18n.t("plugins.marketplace.removeError")}: ${describe(error)}`)
        } finally {
          busyMarketplace(marketplaceName, false)
        }
      },

      upgradeMarketplace: async (marketplaceName) => {
        busyMarketplace(marketplaceName, true)
        try {
          const response = await api.upgradeMarketplaces(marketplaceName)
          await refreshAfterChange(true)
          busyMarketplace(marketplaceName, false)
          if (response.errors.length > 0) {
            toast.error(
              `${i18n.t("plugins.marketplace.upgradeError")}: ${response.errors.map((failure) => failure.message).join("; ")}`
            )
          } else {
            toast.success(i18n.t("plugins.marketplace.upgraded", { marketplaceName }))
          }
        } catch (error) {
          toast.error(`${i18n.t("plugins.marketplace.upgradeError")}: ${describe(error)}`)
        } finally {
          busyMarketplace(marketplaceName, false)
        }
      },

      upgradeAll: async () => {
        if (get().upgrading) return
        set({ upgrading: true })
        try {
          const response = await api.upgradeMarketplaces()
          await refreshAfterChange(true)
          set({ upgrading: false })
          if (response.errors.length > 0) toast.error(i18n.t("plugins.marketplace.upgradeAllError"))
          else toast.success(i18n.t("plugins.marketplace.upgradedAll"))
        } catch (error) {
          toast.error(`${i18n.t("plugins.marketplace.upgradeAllRequestError")}: ${describe(error)}`)
        } finally {
          set({ upgrading: false })
        }
      }
    }
  })
  return store
}
