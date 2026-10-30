import type { PluginDetail, PluginMarketplaceEntry, PluginSummary, SkillMetadata } from "@nyssance/codex-acp-v2/client"

import { client } from "./client"

export type PluginCase = "catalog" | "empty" | "loading" | "error" | "detailError" | "unavailable" | "installed"
export type PluginOperation =
  | "ready"
  | "installing"
  | "installError"
  | "uninstalling"
  | "uninstallError"
  | "toggling"
  | "toggleError"
  | "upgrading"
  | "upgradeError"
  | "skillError"
let operation: PluginOperation = "ready"
async function operationGate(pending: PluginOperation, failure: PluginOperation) {
  if (operation === pending) await new Promise(() => {})
  if (operation === failure) {
    operation = "ready"
    throw new Error("模拟插件操作失败，请重试")
  }
}
let mode: PluginCase = "catalog"
let plugins: PluginSummary[] = []
export const skills: SkillMetadata[] = [
  {
    name: "research",
    description: "查找一手资料，整理研究结果并保留来源。",
    shortDescription: "资料研究与来源核对",
    path: "/demo/skills/research/SKILL.md",
    scope: "user",
    pluginId: null,
    enabled: true
  },
  {
    name: "project-review",
    description: "检查项目页面、交互和交付清单。",
    shortDescription: "项目交付检查",
    path: "/demo/skills/project-review/SKILL.md",
    scope: "repo",
    pluginId: null,
    enabled: true
  },
  {
    name: "write-report",
    description: "将检查记录整理成结构清晰的报告。",
    shortDescription: "整理交付文档",
    path: "/demo/skills/write-report/SKILL.md",
    scope: "user",
    pluginId: null,
    enabled: false
  }
]
// Snapshot of the installed primary-runtime plugin metadata; operation states remain simulated.
const names = [
  [
    "spreadsheets",
    "Spreadsheets",
    "Create and edit spreadsheets",
    "Create, edit, inspect, render, verify, and export XLSX, CSV, and TSV spreadsheets locally, including local XLSX authoring for native Google Sheets handoff. Use Spreadsheets when the durable output or target is a spreadsheet, workbook, sheet, Google Sheet, or CSV file. Use Excel Live Control for working on a spreadsheet open in Microsoft Excel app, through the ChatGPT add-in."
  ],
  [
    "pdf",
    "PDF",
    "Read, create, and verify PDFs",
    "Read, create, inspect, render, verify, and extract content from PDF files locally. Use PDF when the durable output or target is a PDF file and visual layout fidelity matters."
  ],
  [
    "documents",
    "Documents",
    "Create and edit documents",
    "Create, edit, inspect, render, verify, and export DOCX document artifacts locally. Use Documents when the durable output or target is a document, doc, docs, Word file, Google Doc, Google Docs document, memo, report, or writing artifact."
  ],
  [
    "presentations",
    "Presentations",
    "Create and edit presentations",
    "Create, edit, inspect, and verify connected Spaces presentations, with local PPTX authoring and native Google Slides handoff guidance. Render and inspect live presentations through their session or connector; export files when requested. Use Presentations when the durable output or target is a deck, slidedeck, presentation deck, slide deck, slides, PowerPoint, Google Slides, presentation, speaker notes, or visual deck repair."
  ],
  [
    "template-creator",
    "Template Creator",
    "Create or update reusable templates from reference content",
    "Use Template Creator to create reusable templates from documents, spreadsheets, presentations, Google Docs, Slides, and Sheets links, ImageGen or Product Design images, emails, Slack messages, and Site projects. Template Creator preserves the structure, voice, layout, and style of your reference so you can quickly create new versions whenever you need them."
  ]
]
export function marketplace(): PluginMarketplaceEntry {
  return { name: "openai-primary-runtime", path: null, interface: { displayName: "OpenAI" }, plugins }
}
export function pluginEntry(index = 0) {
  return { plugin: plugins[index]!, marketplace: marketplace() }
}
function detail(summary: PluginSummary): PluginDetail {
  return {
    summary,
    marketplaceName: marketplace().name,
    marketplacePath: null,
    shareUrl: null,
    description: summary.interface?.longDescription ?? "",
    mcpServers: ["workspace-search"],
    apps: [],
    hooks: [],
    scheduledTasks: null,
    skills: skills.slice(0, 2).map((skill) => ({
      name: skill.name,
      description: skill.description,
      shortDescription: skill.shortDescription ?? null,
      interface: null,
      path: skill.path,
      enabled: skill.enabled
    }))
  }
}
export function resetPlugins(next: PluginCase = "catalog", nextOperation: PluginOperation = "ready"): void {
  operation = nextOperation
  skills.forEach((skill, index) => {
    skill.enabled = index < 2
  })
  mode = next
  plugins =
    mode === "empty"
      ? []
      : names.map(([name, displayName, description, longDescription], index): PluginSummary => ({
          id: name!,
          name: name!,
          remotePluginId: name!,
          version: "26.1020.11618",
          localVersion: index < 2 ? "26.1020.11618" : null,
          source: { type: "remote" },
          shareContext: null,
          installed: index < 2 || mode === "installed",
          installedAt: index < 2 ? 1792728000 - index : null,
          enabled: index === 0,
          installPolicy: "AVAILABLE",
          installPolicySource: null,
          mustShowInstallationInterstitial: false,
          availability: mode === "unavailable" ? ("PLAN_NOT_ELIGIBLE" as PluginSummary["availability"]) : "AVAILABLE",
          authPolicy: "ON_USE",
          disabledReason: mode === "unavailable" ? "PLAN_NOT_ELIGIBLE" : null,
          eligiblePlanTypes: [],
          keywords: ["工作效率", "文档"],
          interface: {
            displayName: displayName!,
            shortDescription: description!,
            longDescription: longDescription!,
            developerName: "OpenAI",
            category: "Productivity",
            capabilities: ["搜索", "读取文档"],
            websiteUrl: "https://openai.com/",
            privacyPolicyUrl: null,
            termsOfServiceUrl: null,
            defaultPrompt: [],
            brandColor: null,
            composerIcon: null,
            composerIconUrl: null,
            logo: null,
            logoDark: null,
            logoUrl: null,
            logoUrlDark: null,
            screenshots: [],
            screenshotUrls: []
          }
        }))
  client.listPlugins = async () => {
    if (mode === "loading") return new Promise(() => {})
    if (mode === "error") throw new Error("插件目录暂时无法加载，请重试。")
    return {
      marketplaces: [marketplace()],
      marketplaceLoadErrors: [],
      featuredPluginIds: plugins.map((plugin) => plugin.id)
    }
  }
  client.installedPlugins = async () => ({ marketplaces: [marketplace()], marketplaceLoadErrors: [] })
  client.listSkills = async () => ({ data: [{ cwd: "/demo", skills: mode === "empty" ? [] : skills, errors: [] }] })
  client.setSkillEnabled = async ({ path, enabled }) => {
    if (operation === "skillError") {
      operation = "ready"
      throw new Error("模拟技能启停失败")
    }
    const skill = skills.find((skill) => skill.path === path)
    if (skill) skill.enabled = enabled
    return { effectiveEnabled: enabled }
  }
  client.readPlugin = async ({ pluginName }) => {
    if (mode === "detailError") throw new Error("插件详情暂时不可用。重新加载后可继续。")
    return { plugin: detail(plugins.find((plugin) => plugin.name === pluginName) ?? plugins[0]!) }
  }
  client.installPlugin = async ({ pluginName }) => {
    await operationGate("installing", "installError")
    plugins = plugins.map((plugin) =>
      plugin.name === pluginName
        ? { ...plugin, installed: true, enabled: true, installedAt: 1792728000, localVersion: plugin.version }
        : plugin
    )
    return { authPolicy: "ON_USE", appsNeedingAuth: [] }
  }
  client.setPluginEnabled = async (id, enabled) => {
    await operationGate("toggling", "toggleError")
    plugins = plugins.map((plugin) => (plugin.id === id ? { ...plugin, enabled } : plugin))
    return { enabled }
  }
  client.uninstallPlugin = async (id) => {
    await operationGate("uninstalling", "uninstallError")
    plugins = plugins.map((plugin) => (plugin.id === id ? { ...plugin, installed: false, enabled: false } : plugin))
  }
  client.addMarketplace = async () => ({
    marketplaceName: "openai-primary-runtime",
    installedRoot: "/demo/catalog",
    alreadyAdded: false
  })
  client.removeMarketplace = async () => {
    plugins = []
  }
  client.upgradeMarketplaces = async () => {
    await operationGate("upgrading", "upgradeError")
    return {
      selectedMarketplaces: [marketplace().name],
      upgradedRoots: [],
      errors: []
    }
  }
}
