import type { Meta, StoryObj } from "@storybook/react-vite"
import { useEffect } from "react"

import type { PluginSummary } from "../../src/agent/codex-extensions"
import { pluginsStore } from "../../src/features/plugins/instance"
import { PluginsPage } from "../../src/features/plugins/plugins-page"
import { client } from "../../src/lib/client"

function CatalogPreview({ loading = false }: { loading?: boolean }) {
  useEffect(() => {
    const previous = pluginsStore.getState()
    const app = client.state
    const plugins: PluginSummary[] = ["Research workspace", "Design tools", "Documents", "Team knowledge"].map(
      (name, index) => ({
        id: name,
        name,
        remotePluginId: null,
        version: "1.0.0",
        localVersion: null,
        source: { type: "local", path: "/example" },
        installed: index === 0,
        installedAt: null,
        enabled: index === 0,
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
      })
    )
    const marketplace = { name: "Example catalog", path: "/example", interface: null, plugins }
    client.store.setState({
      connection: "ready",
      agent: {
        info: { name: "preview", version: "1" },
        protocolVersion: 2,
        capabilities: { _meta: { codex: { plugins: true, skills: true } } }
      }
    })
    pluginsStore.setState({
      loading,
      marketplaces: [marketplace],
      installed: [{ plugin: plugins[0], marketplace }],
      skillProjects: { "/work/alwith-desktop": ["/project/.agents/skills/review/SKILL.md"] },
      skills: [
        {
          name: "Research",
          description: "Find primary sources, compare evidence, and cite the documents used in your answer.",
          path: "/Users/example/.agents/skills/research/SKILL.md",
          scope: "user",
          enabled: true,
          pluginId: "Research workspace"
        },
        {
          name: "Review code",
          description: "Review the project for correctness and maintainability before shipping changes.",
          path: "/project/.agents/skills/review/SKILL.md",
          scope: "repo",
          enabled: true,
          pluginId: null
        },
        {
          name: "Create a skill",
          description: "Turn a repeatable workflow into instructions and resources for future conversations.",
          path: "/Users/example/.codex/skills/skill-creator/SKILL.md",
          scope: "system",
          enabled: false,
          pluginId: null
        }
      ],
      refresh: async () => {},
      readPlugin: ({ plugin }) =>
        Promise.resolve({
          summary: plugin,
          marketplaceName: marketplace.name,
          marketplacePath: marketplace.path,
          shareUrl: null,
          description: "Explore the capabilities included with this plugin.",
          skillProjects: { "/work/alwith-desktop": ["/project/.agents/skills/review/SKILL.md"] },
          skills: [],
          mcpServers: [],
          apps: [],
          hooks: [],
          scheduledTasks: null
        }),
      setSkillEnabled: (skill, enabled) => {
        pluginsStore.setState((state) => ({
          skills: state.skills.map((item) => (item.path === skill.path ? { ...item, enabled } : item))
        }))

        return Promise.resolve()
      }
    })
    return () => {
      pluginsStore.setState(previous, true)
      client.store.setState(app, true)
    }
  }, [loading])
  return (
    <div className="h-screen min-h-96 bg-background text-foreground">
      <PluginsPage cwd={null} active={false} />
    </div>
  )
}

const meta = {
  title: "Plugins/Catalog",
  component: CatalogPreview,
  parameters: { layout: "fullscreen" }
} satisfies Meta<typeof CatalogPreview>
export default meta
type Story = StoryObj<typeof meta>
export const UnifiedCatalog: Story = {}
export const Narrow: Story = {
  decorators: [
    (Story) => (
      <div className="max-w-[440px]">
        <Story />
      </div>
    )
  ]
}

export const Loading: Story = { args: { loading: true } }
