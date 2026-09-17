import { describe, expect, mock, test } from "bun:test"
import type { PluginMarketplaceEntry, PluginSummary, SkillMetadata } from "@/agent/codex-extensions"
import { createPluginsStore, installParams, type PluginsApi } from "../store"
import { must } from "@/lib/__tests__/must"

mock.module("sonner", () => ({ toast: { success: () => undefined, error: () => undefined, message: () => undefined } }))

function plugin(id: string, installed: boolean): PluginSummary {
  return {
    id,
    remotePluginId: null,
    version: "1.0.0",
    localVersion: null,
    name: id,
    source: { type: "remote" },
    installed,
    installedAt: null,
    enabled: installed,
    installPolicy: "AVAILABLE",
    availability: "AVAILABLE",
    authPolicy: "ON_USE",
    shareContext: null,
    installPolicySource: null,
    mustShowInstallationInterstitial: false,
    disabledReason: null,
    eligiblePlanTypes: [],
    interface: null,
    keywords: []
  }
}

function skill(path: string, enabled: boolean): SkillMetadata {
  return { name: path, description: "", path, scope: "user", enabled, pluginId: null }
}

function fakeApi(): PluginsApi & { calls: string[]; installed: Set<string> } {
  const installed = new Set<string>(["alpha"])
  const calls: string[] = []
  const catalog: PluginMarketplaceEntry = {
    name: "official",
    path: null,
    interface: null,
    plugins: [plugin("alpha", true), plugin("beta", false)]
  }
  return {
    calls,
    installed,
    async listSkills(cwds) {
      calls.push(`skills:${(cwds ?? []).join(",")}`)
      return {
        data: [
          { cwd: "/a", skills: [skill("/home/s1", true), skill("/a/.codex/s2", false)], errors: [] },
          { cwd: "/b", skills: [skill("/home/s1", true)], errors: [{ path: "/b/bad", message: "broken" }] }
        ]
      }
    },
    async setSkillEnabled(params) {
      calls.push(`skill:${params.path}:${params.enabled}`)
      return { effectiveEnabled: params.enabled }
    },
    async listPlugins() {
      return { marketplaces: [catalog], marketplaceLoadErrors: [], featuredPluginIds: [] }
    },
    async installedPlugins() {
      return {
        marketplaces: [{ ...catalog, plugins: catalog.plugins.map(p => ({ ...p, installed: installed.has(p.id) })) }],
        marketplaceLoadErrors: []
      }
    },
    async installPlugin(params) {
      calls.push(`install:${params.pluginName}:${params.remoteMarketplaceName ?? params.marketplacePath}`)
      installed.add(params.pluginName)
      return { authPolicy: "ON_USE", appsNeedingAuth: [] }
    },
    async uninstallPlugin(pluginId) {
      calls.push(`uninstall:${pluginId}`)
      installed.delete(pluginId)
    },
    async readPlugin() {
      throw new Error("readPlugin is not exercised by this fake")
    },
    async addMarketplace(params) {
      calls.push(`add:${params.source}`)
      return { marketplaceName: "x", alreadyAdded: false, installedRoot: "/marketplaces/x" }
    },
    async removeMarketplace(name) {
      calls.push(`remove:${name}`)
    },
    async upgradeMarketplaces() {
      calls.push("upgrade")
      return { errors: [], selectedMarketplaces: [], upgradedRoots: [] }
    }
  }
}

describe("plugins store", () => {
  test("refresh merges skills across cwds by path and indexes installed plugins", async () => {
    const api = fakeApi()
    const store = createPluginsStore(api)
    await store.getState().refresh(["/a", "/b"])
    const state = store.getState()
    expect(state.loading).toBe(false)
    expect(state.skills.map(s => s.path)).toEqual(["/home/s1", "/a/.codex/s2"])
    expect(state.skillErrors).toEqual([{ path: "/b/bad", message: "broken" }])
    expect(state.installed.map(entry => entry.plugin.id)).toEqual(["alpha"])
    expect(api.calls[0]).toBe("skills:/a,/b")
  })

  test("install targets the marketplace by path or remote name and refreshes", async () => {
    const api = fakeApi()
    const store = createPluginsStore(api)
    await store.getState().refresh([])
    const remote = store.getState().marketplaces[0]
    await store.getState().install({ plugin: plugin("beta", false), marketplace: remote })
    expect(api.calls).toContain("install:beta:official")
    expect(store.getState().installed.find(entry => entry.plugin.id === "beta")?.plugin.installed).toBe(true)
    expect(store.getState().busyIds).toEqual({})
    expect(
      installParams({ plugin: plugin("z", false), marketplace: { ...remote, path: "/m/marketplace.json" } })
    ).toEqual({
      installAttemptId: expect.any(String),
      marketplacePath: "/m/marketplace.json",
      pluginName: "z"
    })
  })

  test("uninstall drops the plugin from installed", async () => {
    const api = fakeApi()
    const store = createPluginsStore(api)
    await store.getState().refresh([])
    await store.getState().uninstall(plugin("alpha", true))
    expect(api.calls).toContain("uninstall:alpha")
    expect(store.getState().installed.find(entry => entry.plugin.id === "alpha")).toBeUndefined()
  })

  test("skill toggle is optimistic and settles on Codex's effective state", async () => {
    const api = fakeApi()
    const store = createPluginsStore(api)
    await store.getState().refresh([])
    const target = must(
      store.getState().skills.find(s => s.path === "/a/.codex/s2"),
      "the s2 skill"
    )
    await store.getState().setSkillEnabled(target, true)
    expect(api.calls).toContain("skill:/a/.codex/s2:true")
    expect(store.getState().skills.find(s => s.path === "/a/.codex/s2")?.enabled).toBe(true)
  })
})
