import { act, cleanup, fireEvent, render, within } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import type { PluginMarketplaceEntry, PluginSummary, SkillMetadata } from "@/agent/codex-extensions"
import { must } from "@/lib/__tests__/must"
import { client } from "@/lib/client"
import i18n, { initI18n } from "@/lib/i18n"

import { pluginsStore } from "../instance"
import { PluginsPage } from "../plugins-page"

const initialState = pluginsStore.getState()
const initialAppState = client.state

beforeEach(async () => {
  await initI18n("en")
  pluginsStore.setState({ ...initialState, refresh: async () => {} }, true)
  client.store.setState({
    connection: "ready",
    agent: {
      info: { name: "test", version: "1" },
      protocolVersion: 2,
      capabilities: { _meta: { codex: { plugins: true, skills: true } } }
    }
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  pluginsStore.setState(initialState, true)
  client.store.setState(initialAppState, true)
})

test("until Codex is connected the catalogs are loading, not empty", async () => {
  client.store.setState({ connection: "connecting", agent: null })
  const view = render(<PluginsPage cwd={null} active />)
  expect(view.queryByText("No plugins found")).toBeNull()
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("tab", { name: "Installed" }))))
  expect(view.queryByText("No plugins installed")).toBeNull()
  expect(view.queryByText("No skills found")).toBeNull()
})

function plugin(id: string, installed = false): PluginSummary {
  return {
    id,
    name: id,
    remotePluginId: null,
    version: "1.0.0",
    localVersion: null,
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

test("plugin controls and skill scopes follow a language change without remounting the page", async () => {
  const installed = plugin("Installed example", true)
  const disabled = { ...plugin("Disabled example", true), enabled: false }
  const marketplace: PluginMarketplaceEntry = {
    name: "Example catalog",
    path: "/catalog/marketplace.json",
    interface: null,
    plugins: [
      plugin("Available example"),
      installed,
      { ...plugin("Unavailable example"), availability: "DISABLED_BY_ADMIN" },
      plugin("Installing example")
    ]
  }
  const skills: SkillMetadata[] = (["user", "repo", "system", "admin"] as const).map((scope) => ({
    name: `${scope} skill`,
    description: "Catalog description",
    path: `/skills/${scope}`,
    scope,
    enabled: scope !== "repo",
    pluginId: null
  }))
  pluginsStore.setState({
    marketplaces: [marketplace],
    installed: [installed, disabled].map((plugin) => ({ plugin, marketplace })),
    busyIds: { "Installing example": "installing" },
    skills
  })
  const view = render(<PluginsPage cwd={null} active />)
  expect(view.getByRole("tab", { name: "Marketplace" })).toBeDefined()
  expect(view.getByPlaceholderText("Search plugins")).toBeDefined()
  expect(view.getByRole("button", { name: "Installed" })).toBeDefined()
  expect(view.getByRole("button", { name: "Installing" })).toBeDefined()

  await act(async () => {
    await i18n.changeLanguage("zh-CN")
  })
  expect(view.getByRole("heading", { name: "插件" })).toBeDefined()
  expect(view.getByText("BETA")).toBeDefined()
  expect(view.getByRole("tab", { name: "市场" })).toBeDefined()
  expect(view.getByPlaceholderText("搜索插件")).toBeDefined()
  expect(view.getByPlaceholderText("openai/plugins 或 git@github.com:org/repo.git")).toBeDefined()
  expect(view.getByRole("button", { name: "升级" })).toBeDefined()
  expect(view.getByRole("button", { name: "添加插件市场" })).toBeDefined()
  expect(view.getAllByRole("button", { name: "安装" })).toHaveLength(2)
  expect(view.getByRole("button", { name: "已安装" })).toBeDefined()
  expect(view.getByRole("button", { name: "正在安装" })).toBeDefined()
  expect(view.getByTitle("不可用").hasAttribute("disabled")).toBe(true)
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "页面操作" }))))
  expect(view.getByRole("menuitem", { name: "移除市场" })).toBeDefined()
  await act(() => Promise.try(() => fireEvent.keyDown(view.getByRole("menu"), { key: "Escape" })))

  // Keep the outgoing panel mounted, as it is until its exit transition completes.
  const animation = vi
    .spyOn(view.getByRole("tabpanel", { name: "市场" }), "getAnimations")
    .mockReturnValue([{ finished: new Promise<Animation>(() => {}) } as Animation])
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("tab", { name: "已安装" }))))
  expect(view.getAllByRole("tabpanel")).toHaveLength(2)
  const panel = within(view.getByRole("tabpanel", { name: "已安装" }))
  animation.mockRestore()
  expect(panel.getByRole("heading", { name: "插件" })).toBeDefined()
  expect(panel.getByRole("heading", { name: "技能" })).toBeDefined()
  expect(panel.getByRole("switch", { name: "禁用 Installed example" })).toBeDefined()
  expect(panel.getByRole("switch", { name: "启用 Disabled example" })).toBeDefined()
  for (const scope of ["用户", "项目", "系统", "管理员"]) expect(panel.getByText(scope)).toBeDefined()
  expect(panel.getAllByRole("switch", { name: "禁用技能" })).toHaveLength(3)
  expect(panel.getByRole("switch", { name: "启用技能" })).toBeDefined()
  const actions = panel.getAllByRole("button", { name: "更多操作" })
  await act(() => Promise.try(() => fireEvent.click(must(actions[0], "the first plugin action"))))
  expect(view.getByRole("menuitem", { name: "卸载" })).toBeDefined()
  await act(() => Promise.try(() => fireEvent.keyDown(view.getByRole("menu", { name: "更多操作" }), { key: "Escape" })))

  await act(async () => {
    await i18n.changeLanguage("en")
  })
  expect(panel.getByRole("heading", { name: "Skills" })).toBeDefined()
  expect(panel.getByRole("switch", { name: "Disable Installed example" })).toBeDefined()
  for (const scope of ["User", "Project", "System", "Admin"]) expect(panel.getByText(scope)).toBeDefined()
  expect(view.container.textContent).not.toMatch(/plugins\.|returned an object/)
})

test("empty plugin and skill lists have translated messages in both supported UI languages", async () => {
  const view = render(<PluginsPage cwd={null} active />)
  expect(view.getByText("No plugins found")).toBeDefined()
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("tab", { name: "Installed" }))))
  expect(view.getByText("No plugins installed")).toBeDefined()
  expect(view.getByText("No skills found")).toBeDefined()
  await act(async () => {
    await i18n.changeLanguage("zh-CN")
  })
  expect(view.getByText("尚未安装插件")).toBeDefined()
  expect(view.getByText("找不到技能")).toBeDefined()
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("tab", { name: "市场" }))))
  expect(view.getByText("未找到插件")).toBeDefined()
})

test("plugin icons use the same local Figma asset in marketplace and installed lists", async (): Promise<void> => {
  const entry = plugin("alpha", true)
  const marketplace: PluginMarketplaceEntry = {
    name: "Example catalog",
    path: "/catalog/marketplace.json",
    interface: null,
    plugins: [entry]
  }
  pluginsStore.setState({ marketplaces: [marketplace], installed: [{ plugin: entry, marketplace }] })
  const view = render(<PluginsPage cwd={null} active />)
  const image = must(view.container.querySelector("svg:has(use)"), "plugin icon")
  const definition = must(view.container.querySelector("#plugin-ladybug"), "shared plugin definition")
  expect(view.container.querySelectorAll("symbol")).toHaveLength(65)
  expect(definition.closest('[role="tabpanel"]')).toBeNull()
  const href = must(image.querySelector("use"), "plugin symbol").getAttribute("href")
  expect(href?.endsWith("#plugin-ladybug")).toBe(true)
  expect(image.getAttribute("aria-hidden")).toBe("true")
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("tab", { name: "Installed" }))))
  expect(must(view.container.querySelector("use"), "installed plugin icon").getAttribute("href")).toBe(href)
  expect(view.container.querySelector("#plugin-ladybug")).toBe(definition)
  await act(async () => i18n.changeLanguage("zh-CN"))
  expect(must(view.container.querySelector("use"), "localized plugin icon").getAttribute("href")).toBe(href)
})

test("search paginates large catalogs and a new query resets the page", async () => {
  const plugins = Array.from({ length: 6000 }, (_, index) => plugin(`Searchable ${index}`))
  pluginsStore.setState({
    marketplaces: [{ name: "Remote", path: null, interface: null, plugins }],
    featuredPluginIds: [plugins[0].id]
  })
  const view = render(<PluginsPage cwd={null} active />)
  expect(view.getAllByRole("button", { name: "Install" })).toHaveLength(1)
  await act(() =>
    Promise.try(() =>
      fireEvent.change(view.getByPlaceholderText("Search plugins"), { target: { value: "Searchable" } })
    )
  )
  expect(view.getAllByRole("button", { name: "Install" })).toHaveLength(48)
  expect(view.queryByText("Searchable 48")).toBeNull()
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "Next" }))))
  expect(view.getByText("Searchable 48")).toBeDefined()
  await act(() =>
    Promise.try(() =>
      fireEvent.change(view.getByPlaceholderText("Search plugins"), { target: { value: "Searchable 5999" } })
    )
  )
  expect(view.getByText("Searchable 5999")).toBeDefined()
  expect(view.getAllByRole("button", { name: "Install" })).toHaveLength(1)
})

test("the upgrade spinner belongs only to an upgrade, not plugin mutations or catalog refresh", async () => {
  const view = render(<PluginsPage cwd={null} active />)
  const upgrade = view.getByRole("button", { name: "Upgrade" })
  await act(() => Promise.try(() => pluginsStore.setState({ busyIds: { alpha: "installing" }, loading: true })))
  expect(upgrade).toHaveAttribute("aria-busy", "false")
  expect(upgrade).toBeEnabled()
  await act(() => Promise.try(() => pluginsStore.setState({ upgrading: true })))
  expect(upgrade).toHaveAttribute("aria-busy", "true")
  expect(upgrade).toBeDisabled()
  await act(() => Promise.try(() => pluginsStore.setState({ upgrading: false })))
  expect(upgrade).toBeEnabled()
})

test("installed plugins have functional switches disabled while the plugin is busy", async () => {
  const target = plugin("Example", true)
  const marketplace: PluginMarketplaceEntry = { name: "local", path: "/local", interface: null, plugins: [target] }
  const toggle = vi.fn().mockResolvedValue(undefined)
  pluginsStore.setState({ installed: [{ plugin: target, marketplace }], setPluginEnabled: toggle })
  const view = render(<PluginsPage cwd={null} active />)
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("tab", { name: "Installed" }))))
  const control = view.getByRole("switch", { name: "Disable Example" })
  expect(control).toBeChecked()
  await act(() => Promise.try(() => fireEvent.click(control)))
  expect(toggle).toHaveBeenCalledWith(target, false)
  await act(() => Promise.try(() => pluginsStore.setState({ busyIds: { Example: "toggling" } })))
  expect(control).toHaveAttribute("aria-disabled", "true")
})

test("details read the selected source, retry failures, and preserve the catalog search on return", async () => {
  const target = plugin("Source plugin")
  const marketplace: PluginMarketplaceEntry = { name: "source", path: "/source", interface: null, plugins: [target] }
  const read = vi
    .fn()
    .mockRejectedValueOnce(new Error("Source unavailable"))
    .mockResolvedValue({
      summary: target,
      marketplaceName: "source",
      marketplacePath: "/source",
      shareUrl: null,
      description: "Long description from source",
      skills: [
        {
          name: "Source skill",
          description: "Complete skill description",
          shortDescription: "Short skill description",
          interface: null,
          path: null,
          enabled: true
        }
      ],
      mcpServers: ["source-mcp"],
      hooks: [],
      apps: [],
      scheduledTasks: null
    })
  pluginsStore.setState({ marketplaces: [marketplace], readPlugin: read })
  const view = render(<PluginsPage cwd={null} active />)
  fireEvent.change(view.getByPlaceholderText("Search plugins"), { target: { value: "Source" } })
  fireEvent.click(view.getByRole("button", { name: "Source plugin" }))
  expect(await view.findByRole("alert")).toHaveTextContent("Source unavailable")
  expect(read).toHaveBeenCalledWith({ plugin: target, marketplace })
  fireEvent.click(view.getByRole("button", { name: "Retry" }))
  expect(await view.findByText("Long description from source")).toBeVisible()
  expect(view.getByText("source-mcp")).toBeVisible()
  fireEvent.click(view.getByRole("button", { name: /Source skill/ }))
  expect(await view.findByRole("dialog")).toHaveTextContent("Complete skill description")
  fireEvent.keyDown(view.getByRole("dialog"), { key: "Escape" })
  fireEvent.click(view.getByRole("button", { name: "Plugins" }))
  expect(view.getByPlaceholderText("Search plugins")).toHaveValue("Source")
})

test("install controls do not open details, and detail actions follow refreshed installation state", async () => {
  const target = plugin("Installable")
  const marketplace: PluginMarketplaceEntry = { name: "source", path: "/source", interface: null, plugins: [target] }
  const read = vi.fn().mockResolvedValue({
    summary: target,
    description: null,
    skills: [],
    mcpServers: [],
    hooks: [],
    apps: [],
    scheduledTasks: null
  })
  const install = vi.fn().mockResolvedValue({ authPolicy: "ON_USE", appsNeedingAuth: [] })
  const uninstall = vi.fn().mockResolvedValue(undefined)
  const toggle = vi.fn().mockResolvedValue(undefined)
  pluginsStore.setState({ marketplaces: [marketplace], readPlugin: read, install, uninstall, setPluginEnabled: toggle })
  const view = render(<PluginsPage cwd={null} active />)
  fireEvent.click(view.getByRole("button", { name: "Install" }))
  expect(install).toHaveBeenCalledWith({ plugin: target, marketplace })
  expect(read).not.toHaveBeenCalled()
  fireEvent.click(view.getByRole("button", { name: "Installable" }))
  await view.findByRole("heading", { name: "Installable" })
  const installed = { ...target, installed: true, enabled: true }
  await act(() => Promise.try(() => pluginsStore.setState({ installed: [{ plugin: installed, marketplace }] })))
  fireEvent.click(view.getByRole("switch", { name: "Disable Installable" }))
  expect(toggle).toHaveBeenCalledWith(installed, false)
  fireEvent.click(view.getByRole("button", { name: "Uninstall" }))
  expect(uninstall).toHaveBeenCalledWith(installed)
  await act(() => Promise.try(() => pluginsStore.setState({ installed: [] })))
  expect(view.getByRole("button", { name: "Install plugin" })).toBeEnabled()
})
