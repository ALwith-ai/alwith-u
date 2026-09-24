import { act, fireEvent, render, within } from "@testing-library/react"
import { afterEach, beforeEach, expect, test } from "bun:test"
import type { PluginMarketplaceEntry, PluginSummary, SkillMetadata } from "@/agent/codex-extensions"
import { installDom } from "@/features/chat/codex/__tests__/dom-environment"
import { must } from "@/lib/__tests__/must"
import i18n, { initI18n } from "@/lib/i18n"
import { pluginsStore } from "../instance"
import { PluginsPage } from "../plugins-page"

installDom()
const initialState = pluginsStore.getState()

beforeEach(async () => {
  await initI18n("en")
  pluginsStore.setState({ ...initialState, refresh: async () => {} }, true)
})
afterEach(() => pluginsStore.setState(initialState, true))

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
  const skills: SkillMetadata[] = (["user", "repo", "system", "admin"] as const).map(scope => ({
    name: `${scope} skill`,
    description: "Catalog description",
    path: `/skills/${scope}`,
    scope,
    enabled: scope !== "repo",
    pluginId: null
  }))
  pluginsStore.setState({
    marketplaces: [marketplace],
    installed: [installed, disabled].map(plugin => ({ plugin, marketplace })),
    busyIds: { "Installing example": "installing" },
    skills
  })
  const view = render(<PluginsPage cwd={null} active />)
  expect(view.getByRole("tab", { name: "Marketplace" })).toBeDefined()
  expect(view.getByPlaceholderText("Search plugins")).toBeDefined()
  expect(view.getByRole("button", { name: "Installed", exact: true })).toBeDefined()
  expect(view.getByRole("button", { name: "Installing", exact: true })).toBeDefined()

  await act(async () => {
    await i18n.changeLanguage("zh-CN")
  })
  expect(view.getByRole("heading", { name: "插件" })).toBeDefined()
  expect(view.getByText("测试版")).toBeDefined()
  expect(view.getByRole("tab", { name: "市场" })).toBeDefined()
  expect(view.getByPlaceholderText("搜索插件")).toBeDefined()
  expect(view.getByPlaceholderText("openai/plugins 或 git@github.com:org/repo.git")).toBeDefined()
  expect(view.getByRole("button", { name: "升级" })).toBeDefined()
  expect(view.getByRole("button", { name: "添加插件市场" })).toBeDefined()
  expect(view.getAllByRole("button", { name: "安装", exact: true })).toHaveLength(2)
  expect(view.getByRole("button", { name: "已安装", exact: true })).toBeDefined()
  expect(view.getByRole("button", { name: "正在安装", exact: true })).toBeDefined()
  expect(view.getByTitle("不可用").hasAttribute("disabled")).toBe(true)
  await act(async () => fireEvent.click(view.getByRole("button", { name: "页面操作" })))
  expect(view.getByRole("menuitem", { name: "移除市场" })).toBeDefined()
  await act(async () => fireEvent.keyDown(view.getByRole("menu"), { key: "Escape" }))

  await act(async () => fireEvent.click(view.getByRole("tab", { name: "已安装" })))
  const panel = within(view.getByRole("tabpanel"))
  expect(panel.getByRole("heading", { name: "插件" })).toBeDefined()
  expect(panel.getByRole("heading", { name: "技能" })).toBeDefined()
  expect(panel.getByText("插件已启用")).toBeDefined()
  expect(panel.getByText("插件已禁用")).toBeDefined()
  for (const scope of ["用户", "项目", "系统", "管理员"]) expect(panel.getByText(scope)).toBeDefined()
  expect(panel.getAllByRole("switch", { name: "禁用技能" })).toHaveLength(3)
  expect(panel.getByRole("switch", { name: "启用技能" })).toBeDefined()
  const actions = panel.getAllByRole("button", { name: "更多操作" })
  await act(async () => fireEvent.click(must(actions[0])))
  expect(view.getByRole("menuitem", { name: "卸载" })).toBeDefined()
  await act(async () => fireEvent.keyDown(view.getByRole("menu"), { key: "Escape" }))

  await act(async () => {
    await i18n.changeLanguage("en")
  })
  expect(panel.getByRole("heading", { name: "Skills" })).toBeDefined()
  expect(panel.getByText("Plugin enabled")).toBeDefined()
  for (const scope of ["User", "Project", "System", "Admin"]) expect(panel.getByText(scope)).toBeDefined()
  expect(view.container.textContent).not.toMatch(/plugins\.|returned an object/)
})

test("empty plugin and skill lists have translated messages in both supported UI languages", async () => {
  const view = render(<PluginsPage cwd={null} active />)
  expect(view.getByText("No plugins found")).toBeDefined()
  await act(async () => fireEvent.click(view.getByRole("tab", { name: "Installed" })))
  expect(view.getByText("No plugins installed")).toBeDefined()
  expect(view.getByText("No skills found")).toBeDefined()
  await act(async () => {
    await i18n.changeLanguage("zh-CN")
  })
  expect(view.getByText("尚未安装插件")).toBeDefined()
  expect(view.getByText("找不到技能")).toBeDefined()
  await act(async () => fireEvent.click(view.getByRole("tab", { name: "市场" })))
  expect(view.getByText("未找到插件")).toBeDefined()
})
