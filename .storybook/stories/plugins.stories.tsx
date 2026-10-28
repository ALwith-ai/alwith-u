import type { PluginDetail, PluginSummary } from "@nyssance/codex-acp-v2/client"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { mockIPC } from "@tauri-apps/api/mocks"
import { useEffect, useLayoutEffect } from "react"
import { expect, userEvent, waitFor, within } from "storybook/test"

import { LeadingNavigation } from "../../src/features/layout/components/leading-navigation"
import { pluginsStore } from "../../src/features/plugins/instance"
import { PluginDetailPage } from "../../src/features/plugins/plugin-detail-page"
import { PluginIconDefinitions } from "../../src/features/plugins/plugin-icon"
import { PluginsPage } from "../../src/features/plugins/plugins-page"
import { client } from "../../src/lib/client"

const summary: PluginSummary = {
  id: "example-plugin",
  name: "example-plugin",
  remotePluginId: null,
  version: "1.0.0",
  localVersion: null,
  source: { type: "remote" },
  shareContext: null,
  installed: false,
  installedAt: null,
  enabled: false,
  installPolicy: "AVAILABLE",
  installPolicySource: null,
  mustShowInstallationInterstitial: false,
  availability: "AVAILABLE",
  authPolicy: "ON_USE",
  disabledReason: null,
  eligiblePlanTypes: [],
  keywords: ["Research", "Documents"],
  interface: {
    displayName: "Research workspace",
    shortDescription: "Find sources and turn your research into useful documents.",
    longDescription:
      "Search your connected workspace, compare source material, and prepare a document with citations.\n\nPlugin descriptions and capabilities are supplied by the source catalog.",
    developerName: "Example developer",
    category: "Productivity",
    capabilities: ["Search", "Read documents"],
    websiteUrl: "https://example.com",
    privacyPolicyUrl: "https://example.com/privacy",
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
}
const marketplace = { name: "Example catalog", path: null, interface: null, plugins: [summary] }
const entry = { plugin: summary, marketplace }
const detail: PluginDetail = {
  summary,
  marketplaceName: marketplace.name,
  marketplacePath: null,
  shareUrl: null,
  description: null,
  mcpServers: ["workspace"],
  apps: [],
  hooks: [],
  scheduledTasks: null,
  skills: [
    {
      name: "research",
      description: "Find primary sources, compare the evidence and cite the documents used in the answer.",
      shortDescription: "Research and summarize source documents.",
      interface: null,
      path: null,
      enabled: true
    }
  ]
}

function DetailPreview({ failed = false }: { failed?: boolean }) {
  useEffect(() => {
    const previous = pluginsStore.getState()
    pluginsStore.setState({
      installed: [],
      busyIds: {},
      readPlugin: () => (failed ? Promise.reject(new Error("Source unavailable")) : Promise.resolve(detail))
    })
    return () => pluginsStore.setState(previous, true)
  }, [failed])
  return (
    <div className="h-[850px] bg-background text-foreground">
      <PluginIconDefinitions />
      <PluginDetailPage entry={entry} onBack={() => {}} />
    </div>
  )
}

const meta = { title: "Plugins/Detail", component: DetailPreview, parameters: { layout: "fullscreen" } } satisfies Meta<
  typeof DetailPreview
>
export default meta
type Story = StoryObj<typeof meta>
export const SourceDetails: Story = {}
export const SourceUnavailable: Story = { args: { failed: true } }

export const SkillMarkdown: Story = {
  beforeEach: () => {
    mockIPC((command) => {
      if (command === "workspace_open") return "/example/research"
      if (command === "workspace_file")
        return [
          ...new TextEncoder().encode(
            `---\nname: Research\n---\n# Research instructions\n\nUse **primary sources** and compare the evidence.\n\n## Deliverable\n\n- Cite each source.\n- Explain uncertainty.\n${"\n\nEvidence and implementation details for the research report.\n".repeat(
              60
            )}`
          )
        ]
      throw new Error(`Unexpected preview command: ${command}`)
    })
    const skill = detail.skills[0]
    const previous = { ...skill }
    skill.path = "/example/research/SKILL.md"
    skill.shortDescription =
      "Research and summarize primary source documents, compare detailed evidence, identify uncertainty, and prepare a complete report with citations for every claim."
    return () => {
      Object.assign(skill, previous)
    }
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: /research Research/ }))
    const heading = await within(document.body).findByRole("heading", { name: "Research instructions" })
    await waitFor(async () => {
      await expect(heading).toBeVisible()
    })
    const dialog = heading.closest('[data-slot="dialog-content"]')!
    const header = dialog.firstElementChild!
    const scroller = dialog.querySelector(".skill-document")!
    const top = header.getBoundingClientRect().top
    await expect(scroller.getBoundingClientRect().height).toBeCloseTo(window.innerHeight * 0.45, 0)
    scroller.scrollTop = scroller.scrollHeight
    await expect(scroller.scrollTop).toBeGreaterThan(0)
    await expect(header.getBoundingClientRect().top).toBe(top)
    await expect(getComputedStyle(dialog).overflowY).toBe("hidden")
  }
}

function CatalogPreview() {
  useLayoutEffect(() => {
    const previous = pluginsStore.getState()
    const connection = client.state
    const installed = { ...summary, installed: true, enabled: true }
    pluginsStore.setState({
      marketplaces: [{ ...marketplace, plugins: [installed] }],
      installed: [{ plugin: installed, marketplace }],
      loadedScope: "[]",
      loading: false,
      error: null,
      busyIds: {},
      refresh: () => Promise.resolve(),
      readPlugin: () => Promise.resolve({ ...detail, summary: installed })
    })
    client.store.setState({
      connection: "ready",
      agent: {
        info: { name: "preview", version: "1" },
        protocolVersion: 2,
        capabilities: { _meta: { codex: { plugins: true, skills: true } } }
      }
    })
    return () => {
      pluginsStore.setState(previous, true)
      client.store.setState(connection, true)
    }
  }, [])
  return (
    <div className="flex h-[800px]">
      <LeadingNavigation
        activePage="plugins"
        onOpenVibemon={() => {}}
        onOpenPlugins={() => {}}
        onOpenExtensions={() => {}}
        onOpenArchives={() => {}}
      />
      <div className="min-w-0 flex-1">
        <PluginsPage cwd={null} active />
      </div>
    </div>
  )
}

export const CatalogLayout: Story = {
  globals: { locale: "en" },
  render: () => <CatalogPreview />,
  play: async ({ canvasElement }) => {
    const ui = within(canvasElement)
    const sidebar = await ui.findByRole("complementary", { name: "Customization navigation" })
    const main = ui.getByRole("main", { name: "Plugin and skill content" })
    const sideHeader = sidebar.querySelector("[data-plugin-sidebar-header]")!
    const mainHeader = main.querySelector("[data-plugin-page-header]")!
    const center = (node: Element) => {
      const box = node.getBoundingClientRect()
      return box.top + box.height / 2
    }
    const headerCenter = center(mainHeader)
    const catalogHeading = within(main).getByRole("heading", { name: "Plugins", level: 1 })
    await expect(catalogHeading.getBoundingClientRect().top - main.getBoundingClientRect().top).toBeCloseTo(32, 0)
    await expect(sideHeader.getBoundingClientRect().top - sidebar.getBoundingClientRect().top).toBeCloseTo(12, 0)
    const left = catalogHeading.getBoundingClientRect().left
    await expect(left - sidebar.getBoundingClientRect().right).toBeCloseTo(40, 0)
    const customize = within(sidebar).getByRole("heading", { name: "Customize" })
    const railIcon = canvasElement.querySelector(".leading-navigation button svg")!
    await expect(center(customize)).toBeCloseTo(center(railIcon), 0)
    const skillsButton = within(ui.getByRole("navigation", { name: "Manage extensions" })).getByRole("button", {
      name: "Skills"
    })
    const installedHeading = within(sidebar).getByRole("heading", { name: "Installed" })
    await expect(
      installedHeading.getBoundingClientRect().top - skillsButton.getBoundingClientRect().bottom
    ).toBeCloseTo(8, 0)
    await expect(main.getBoundingClientRect().right - mainHeader.getBoundingClientRect().right).toBeCloseTo(40, 0)
    const installed = within(ui.getByRole("navigation", { name: "Installed" }))
    await userEvent.click(installed.getByRole("button", { name: "Research workspace" }))
    const detailHeading = await ui.findByRole("heading", { name: "Research workspace", level: 1 })
    await expect(center(main.querySelector("[data-plugin-page-header]")!)).toBeCloseTo(headerCenter, 0)
    await expect(detailHeading.closest("[data-slot=scroll-area]")!.getBoundingClientRect().left + 40).toBeCloseTo(
      left,
      0
    )
    const description = await ui.findByText("Find sources and turn your research into useful documents.")
    await expect(description).toBeVisible()
    await expect(sidebar).toBeVisible()
  }
}
