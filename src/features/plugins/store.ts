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
} from "@alwith/module-chat/client"
// Plugins & marketplace state, shaped after the official Codex app's local plugins page:
// the catalog (`plugin/list`: marketplaces + featured ids), the installed set
// (`plugin/installed`, newest first), skills (`skills/list`), and the actions the page runs.
// Every action talks to Codex through the client and re-reads the catalogs afterwards, the
// way the official page invalidates its queries.
import { toast } from "sonner"
import { createStore, type StoreApi } from "zustand/vanilla"

import i18n from "@/lib/i18n"

import { RequestCache, skillDocuments } from "./request-cache"

/** The client methods the store needs; tests pass a fake. */
export type PluginsApi = {
  listSkills: (cwds?: string[], forceReload?: boolean) => Promise<SkillsListResponse>
  setSkillEnabled: (params: SkillsConfigWriteParams) => Promise<SkillsConfigWriteResponse>
  listPlugins: (params?: PluginListParams) => Promise<PluginListResponse>
  installedPlugins: (cwds?: string[]) => Promise<PluginInstalledResponse>
  installPlugin: (params: PluginInstallParams) => Promise<PluginInstallResponse>
  setPluginEnabled: (pluginId: string, enabled: boolean, remotePluginId?: string) => Promise<{ enabled: boolean }>
  uninstallPlugin: (pluginId: string) => Promise<void>
  readPlugin: (params: PluginReadParams) => Promise<PluginReadResponse>
  addMarketplace: (params: MarketplaceAddParams) => Promise<MarketplaceAddResponse>
  removeMarketplace: (marketplaceName: string) => Promise<void>
  upgradeMarketplaces: (marketplaceName?: string) => Promise<MarketplaceUpgradeResponse>
}

/** A plugin together with the marketplace it was listed under (needed to install and read). */
export type PluginEntry = { plugin: PluginSummary; marketplace: PluginMarketplaceEntry }

type PluginsState = {
  loading: boolean
  skillsLoading: boolean
  pluginsLoading: boolean
  installedLoading: boolean
  skillsError: string | null
  pluginsError: string | null
  installedError: string | null
  skillProjectLoading: Record<string, boolean>
  skillProjectErrors: Record<string, string>
  loadSkillProject: (cwd: string) => Promise<void>
  discoverSkillProjects: (cwds: string[], signal: AbortSignal) => Promise<void>
  loadedScope: string | null
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
  /** Repository skill membership from each skills/list cwd, keyed by absolute project path. */
  skillProjects: Record<string, string[]>
  skillErrors: SkillErrorInfo[]
  /** Plugin ids with an install, uninstall or enablement change in flight. */
  busyIds: Record<string, "installing" | "uninstalling" | "toggling">
  /** Skill paths with an enablement change in flight. */
  busySkills: Record<string, true>
  /** Marketplace names with an upgrade or removal in flight. */
  busyMarketplaces: Record<string, true>
  refresh: (
    cwds?: string[],
    options?: { forceRefetch?: boolean; background?: boolean; cached?: boolean }
  ) => Promise<void>
  invalidate: () => void
  skillsChanged: () => Promise<void>
  cachedPlugin: (entry: PluginEntry) => PluginDetail | undefined
  /** Installs and returns Codex's answer (apps that still need auth); throws on failure. */
  install: (entry: PluginEntry) => Promise<PluginInstallResponse>
  setPluginEnabled: (plugin: PluginSummary, enabled: boolean) => Promise<void>
  uninstall: (plugin: PluginSummary) => Promise<void>
  readPlugin: (entry: PluginEntry) => Promise<PluginDetail>
  setSkillEnabled: (skill: SkillMetadata, enabled: boolean) => Promise<void>
  addMarketplace: (params: MarketplaceAddParams) => Promise<MarketplaceAddResponse>
  removeMarketplace: (marketplaceName: string) => Promise<void>
  upgradeMarketplace: (marketplaceName: string) => Promise<void>
  upgradeAll: () => Promise<void>
}

export type PluginsStore = StoreApi<PluginsState>

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function pluginTitle(plugin: PluginSummary): string {
  return plugin.interface?.displayName ?? plugin.name
}

/** Skills for several cwds overlap (user and system scopes repeat); one row per path. */
function mergeSkills(response: SkillsListResponse): {
  skills: SkillMetadata[]
  errors: SkillErrorInfo[]
  projects: Record<string, string[]>
} {
  const projects: Record<string, string[]> = {}
  const byPath = new Map<string, SkillMetadata>()
  const errors = new Map<string, SkillErrorInfo>()
  for (const entry of response.data) {
    for (const skill of entry.skills) {
      byPath.set(skill.path, skill)
      if (skill.scope === "repo") {
        const paths = projects[entry.cwd] ?? []
        if (!paths.includes(skill.path)) paths.push(skill.path)
        projects[entry.cwd] = paths
      }
    }
    for (const error of entry.errors) errors.set(error.path, error)
  }
  return { skills: [...byPath.values()], errors: [...errors.values()], projects }
}

/** Installed plugins across marketplaces, newest install first, as the official Manage tab sorts. */
function installedEntries(response: PluginInstalledResponse): PluginEntry[] {
  const entries: PluginEntry[] = []
  for (const marketplace of response.marketplaces) {
    for (const plugin of marketplace.plugins) if (plugin.installed) entries.push({ plugin, marketplace })
  }
  return entries.toSorted((a, b) => (b.plugin.installedAt ?? 0) - (a.plugin.installedAt ?? 0))
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
    const skillsCache = new RequestCache<SkillsListResponse>("plugins.skills")
    const pluginsCache = new RequestCache<PluginListResponse>("plugins.marketplace")
    const installedCache = new RequestCache<PluginInstalledResponse>("plugins.installed")
    const details = new RequestCache<PluginDetail>("plugins.detail")
    const flights = new Map<string, { promise: Promise<void>; force: boolean; epoch: number }>()
    let skillView = new Set<string>()
    const projectReads = new Map<string, { epoch: number; scope: string; promise: Promise<void> }>()
    let epoch = 0
    let notification: Promise<void> | null = null
    let notificationDirty = false
    const mutating = () =>
      Object.keys(get().busyIds).length > 0 ||
      Object.keys(get().busySkills).length > 0 ||
      Object.keys(get().busyMarketplaces).length > 0 ||
      get().upgrading
    const detailKey = (entry: PluginEntry) =>
      JSON.stringify([readParams(entry), entry.plugin.version, entry.plugin.localVersion])
    const invalidate = () => {
      epoch++
      skillsCache.clear()
      pluginsCache.clear()
      installedCache.clear()
      details.clear()
      skillDocuments.clear()
      set({ loadedScope: null, skillProjectLoading: {}, skillProjectErrors: {} })
    }
    const refreshAfterChange = async (forceRefetch = false) => {
      invalidate()
      await get().refresh(undefined, { forceRefetch, background: true })
      if (get().error) throw new Error(i18n.t("plugins.toast.syncError", { message: get().error }))
    }
    const readSkills = (cwds: string[], refresh: boolean, force: boolean): Promise<SkillsListResponse> => {
      // Empty scope uses Codex's default working directory, kept separate from explicit paths.
      const keys = cwds.length ? cwds : [""]
      const missing = keys.filter((key) => !skillsCache.pending(key) && (refresh || !skillsCache.peek(key)))
      let batch: Promise<SkillsListResponse> | undefined
      return Promise.all(
        keys.map((key) =>
          skillsCache.read(
            key,
            async () => {
              batch ??= api.listSkills(missing.filter(Boolean), force)
              const response = await batch
              if (key === "") {
                return response
              }
              const entry = response.data.find((entry) => entry.cwd === key)
              if (!entry) throw new Error(`Codex returned no skill catalog for ${key}`)
              return { data: [entry] }
            },
            refresh
          )
        )
      ).then((responses) => ({ data: responses.flatMap((response) => response.data) }))
    }
    const skillProjection = () => {
      const merged = mergeSkills({ data: [...skillView].flatMap((cwd) => skillsCache.peek(cwd)?.data ?? []) })
      return {
        skills: merged.skills,
        skillErrors: merged.errors,
        skillProjects: merged.projects
      }
    }
    const loadProjectBatch = (directories: string[]): Promise<void> => {
      const scope = JSON.stringify(get().cwds)
      const existing = directories.length === 1 ? projectReads.get(directories[0]!) : undefined
      if (existing?.epoch === epoch && existing.scope === scope) return existing.promise
      const revision = epoch
      const current = () => revision === epoch && scope === JSON.stringify(get().cwds)
      for (const cwd of directories) skillView.add(cwd)
      set((state) => ({
        skillProjectLoading: {
          ...state.skillProjectLoading,
          ...Object.fromEntries(directories.map((cwd) => [cwd, !skillsCache.peek(cwd)]))
        },
        skillProjectErrors: { ...state.skillProjectErrors, ...Object.fromEntries(directories.map((cwd) => [cwd, ""])) }
      }))
      const promise = readSkills(directories, false, false)
        .then(() => {
          if (current()) set(skillProjection())
        })
        .catch((error: unknown) => {
          if (current())
            set((state) => ({
              skillProjectErrors: {
                ...state.skillProjectErrors,
                ...Object.fromEntries(directories.map((cwd) => [cwd, describe(error)]))
              }
            }))
        })
        .finally(() => {
          if (current())
            set((state) => ({
              skillProjectLoading: {
                ...state.skillProjectLoading,
                ...Object.fromEntries(directories.map((cwd) => [cwd, false]))
              }
            }))
          for (const cwd of directories) if (projectReads.get(cwd)?.promise === promise) projectReads.delete(cwd)
        })
      for (const cwd of directories) projectReads.set(cwd, { epoch: revision, scope, promise })
      return promise
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
      skillsLoading: false,
      pluginsLoading: false,
      installedLoading: false,
      skillsError: null,
      pluginsError: null,
      installedError: null,
      skillProjectLoading: {},
      skillProjectErrors: {},
      loadedScope: null,
      upgrading: false,
      error: null,
      cwds: [],
      marketplaces: [],
      marketplaceLoadErrors: [],
      featuredPluginIds: [],
      installed: [],
      skills: [],
      skillProjects: {},
      skillErrors: [],
      busyIds: {},
      busySkills: {},
      busyMarketplaces: {},

      invalidate,
      loadSkillProject: (cwd) => loadProjectBatch([cwd]),
      discoverSkillProjects: async (directories, signal) => {
        if (signal.aborted || get().skillsLoading) return
        const revision = epoch
        const scope = JSON.stringify(get().cwds)
        const current = () => !signal.aborted && revision === epoch && scope === JSON.stringify(get().cwds)
        const directoriesToRead = [...new Set(directories)].filter((cwd) => !get().cwds.includes(cwd)).toSorted()
        for (const cwd of directoriesToRead) if (skillsCache.peek(cwd)) skillView.add(cwd)
        const missing = directoriesToRead.filter((cwd) => !skillsCache.peek(cwd))
        if (current()) set(skillProjection())
        // One small batch at a time leaves the foreground catalogs and interactions responsive.
        for (let offset = 0; offset < missing.length && current(); offset += 4) {
          await loadProjectBatch(missing.slice(offset, offset + 4))
          if (current()) await new Promise<void>((resolve) => setTimeout(resolve, 0))
        }
      },
      skillsChanged: () => {
        // The mutation's readback owns notifications received before its response.
        if (mutating()) return Promise.resolve()
        notificationDirty = true
        notification ??= (async () => {
          do {
            await new Promise<void>((resolve) => setTimeout(resolve, 50))
            notificationDirty = false
            if (mutating()) return
            invalidate()
            await get().refresh(undefined, { background: true })
          } while (notificationDirty)
        })().finally(() => {
          notification = null
        })
        return notification
      },
      refresh: (directories = get().cwds, options = {}) => {
        const cwds = [...new Set(directories)].toSorted()
        const key = JSON.stringify(cwds)
        const existing = flights.get(key)
        const force = options.forceRefetch === true
        // Same-scope callers share one read. An explicit forced reload supersedes a cached read.
        const joining = existing?.epoch === epoch && (!force || existing.force)
        if (joining && JSON.stringify(get().cwds) === key) return existing.promise
        if (force && !joining) invalidate()
        const revision = epoch
        const current = () => revision === epoch && JSON.stringify(get().cwds) === key
        const refresh = !joining && options.cached !== true
        const cachedSkills = (cwds.length ? cwds : [""]).map((cwd) => skillsCache.peek(cwd))
        const haveSkills = cachedSkills.every((entry) => entry !== undefined)
        const cachedPlugins = pluginsCache.peek(key)
        const cachedInstalled = installedCache.peek(key)
        const changedScope = JSON.stringify(get().cwds) !== key
        skillView = new Set(cwds.length ? cwds : [""])
        if (refresh) {
          details.clear()
          skillDocuments.clear()
        }
        set({
          cwds,
          loading: joining ? get().loading || !options.background : !options.background,
          error: null,
          skillsError: null,
          pluginsError: null,
          installedError: null,
          skillsLoading: refresh || !haveSkills,
          pluginsLoading: refresh || !cachedPlugins,
          installedLoading: refresh || !cachedInstalled,
          ...(haveSkills ? skillProjection() : changedScope ? { skills: [], skillProjects: {}, skillErrors: [] } : {}),
          ...(cachedPlugins
            ? {
                marketplaces: cachedPlugins.marketplaces,
                marketplaceLoadErrors: cachedPlugins.marketplaceLoadErrors,
                featuredPluginIds: cachedPlugins.featuredPluginIds
              }
            : changedScope
              ? { marketplaces: [], marketplaceLoadErrors: [], featuredPluginIds: [] }
              : {}),
          ...(cachedInstalled
            ? { installed: installedEntries(cachedInstalled) }
            : changedScope
              ? { installed: [] }
              : {})
        })
        const fail = (
          field: "skillsError" | "pluginsError" | "installedError",
          loading: "skillsLoading" | "pluginsLoading" | "installedLoading",
          error: unknown
        ) => {
          if (current()) set({ [field]: describe(error), [loading]: false, error: describe(error) })
        }
        const promise = Promise.all([
          readSkills(cwds, refresh, force)
            .then(() => {
              if (current()) set({ ...skillProjection(), skillsLoading: false })
            })
            .catch((error: unknown) => fail("skillsError", "skillsLoading", error)),
          pluginsCache
            .read(
              key,
              () => api.listPlugins({ ...(cwds.length ? { cwds } : {}), ...(force ? { forceRefetch: true } : {}) }),
              refresh
            )
            .then((response) => {
              if (current())
                set({
                  marketplaces: response.marketplaces,
                  marketplaceLoadErrors: response.marketplaceLoadErrors,
                  featuredPluginIds: response.featuredPluginIds,
                  pluginsLoading: false
                })
            })
            .catch((error: unknown) => fail("pluginsError", "pluginsLoading", error)),
          installedCache
            .read(key, () => api.installedPlugins(cwds), refresh)
            .then((response) => {
              if (current())
                set({
                  installed: installedEntries(response),
                  installedLoading: false,
                  ...(get().marketplaces.length === 0 ? { marketplaces: response.marketplaces } : {})
                })
            })
            .catch((error: unknown) => fail("installedError", "installedLoading", error))
        ])
          .then(() => {
            if (current()) set({ loadedScope: get().error ? null : key, loading: false })
          })
          .finally(() => {
            if (flights.get(key)?.promise === promise) flights.delete(key)
          })
        flights.set(key, { promise, force, epoch: revision })
        return promise
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

      cachedPlugin: (entry) => details.peek(detailKey(entry)),
      readPlugin: (entry) =>
        details.read(detailKey(entry), async () => (await api.readPlugin(readParams(entry))).plugin),

      setSkillEnabled: async (skill, enabled) => {
        if (skill.path in get().busySkills) return
        set((state) => ({ busySkills: { ...state.busySkills, [skill.path]: true } }))
        // Optimistic: the switch reflects the request; Codex answers with the effective state.
        set((state) => ({
          skills: state.skills.map((item) => (item.path === skill.path ? { ...item, enabled } : item))
        }))
        const name = skill.interface?.displayName ?? skill.name
        try {
          const response = await api.setSkillEnabled({ path: skill.path, enabled })
          invalidate()
          set((state) => ({
            skills: state.skills.map((item) =>
              item.path === skill.path ? { ...item, enabled: response.effectiveEnabled } : item
            )
          }))
          if (response.effectiveEnabled !== enabled) {
            toast.error(i18n.t("plugins.catalog.toggleNotApplied"))
            return
          }
          toast.success(
            i18n.t(enabled ? "plugins.skills.enabledToast" : "plugins.skills.disabledToast", { skillName: name })
          )
        } catch (error) {
          set((state) => ({
            skills: state.skills.map((item) => (item.path === skill.path ? { ...item, enabled: skill.enabled } : item))
          }))
          toast.error(`${i18n.t("plugins.skills.toggleError")}: ${describe(error)}`)
        } finally {
          set((state) => {
            const busySkills = { ...state.busySkills }
            delete busySkills[skill.path]
            return { busySkills }
          })
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
