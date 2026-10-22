import type { Meta, StoryObj } from "@storybook/react-vite"
import { useEffect } from "react"

import type { PluginDetail, PluginSummary } from "../../src/agent/codex-extensions"
import { pluginsStore } from "../../src/features/plugins/instance"
import { PluginDetailPage } from "../../src/features/plugins/plugin-detail-page"
import { PluginIconDefinitions } from "../../src/features/plugins/plugin-icon"

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
