import type { Meta, StoryObj } from "@storybook/react-vite"
import type { ExtensionManifest } from "@alwith/module-extension"
import type { HostSnapshot } from "@alwith/module-extension/host"
import { expect, waitFor } from "storybook/test"
import { useState } from "react"
import { SidebarInset } from "../../src/components/ui/sidebar"
import { LeadingNavigation } from "../../src/features/layout/components/leading-navigation"
import { ExtensionNavigation } from "../../src/features/extensions/extension-navigation"
import { MainSidebarLayout } from "../../src/features/layout/components/main-sidebar-layout"

const meta = {
  title: "Layout/Direction",
  component: MainSidebarLayout,
  args: {
    initialPinned: true,
    screen: "main",
    sidebar: (
      <div className="p-8" data-testid="navigation">
        Navigation
      </div>
    ),
    main: <div className="p-8">Chat</div>,
    leading: <div className="p-8">Activity</div>
  }
} satisfies Meta<typeof MainSidebarLayout>
export default meta
type Story = StoryObj<typeof meta>

const extensionManifests: ExtensionManifest[] = Array.from({ length: 20 }, (_, index) => ({
  id: `app-${index}`,
  name: `App ${index + 1}`,
  version: "1.0.0",
  manifestVersion: 3,
  entry: "main.js",
  dataSchemaVersion: 1,
  dependencies: { "@alwith/module-extension": "^0.1.0" },
  hosts: {}
}))
const extensionHost: HostSnapshot = {
  instances: [],
  commands: [],
  views: extensionManifests.map(item => ({
    id: `${item.id}/page`,
    extensionId: item.id,
    title: item.name,
    kind: "surfaces",
    mount: () => () => {}
  })),
  actions: extensionManifests.map((item, index) => ({
    id: `${item.id}/open`,
    extensionId: item.id,
    title: item.name,
    placement: "navigation",
    icon: index % 2 === 0 ? "chart" : "globe",
    target: { type: "surface", id: `${item.id}/page` }
  }))
}

export const LeadingApps: Story = {
  args: { screen: "leading" },
  globals: { locale: "en" },
  render: function Render(args) {
    const [active, setActive] = useState<string | null>(null)
    return (
      <div className="bg-sidebar h-[640px]">
        <MainSidebarLayout
          {...args}
          leading={
            <>
              <LeadingNavigation
                activePage={active ? null : "extensions"}
                onOpenVibemon={() => setActive(null)}
                onOpenPlugins={() => setActive(null)}
                onOpenArchives={() => setActive(null)}
                onOpenExtensions={() => setActive(null)}>
                <ExtensionNavigation
                  host={extensionHost}
                  manifests={extensionManifests}
                  activeView={active}
                  onOpenSurface={setActive}
                  onError={error => {
                    throw error
                  }}
                />
              </LeadingNavigation>
              <SidebarInset className="main-chat-surface flex min-h-0 flex-col p-8">
                <h1>{active ?? "Extensions"}</h1>
              </SidebarInset>
            </>
          }
        />
      </div>
    )
  },
  play: async ({ canvas, userEvent }) => {
    const fixed = canvas.getByRole("button", { name: "Vibémon" })
    const top = fixed.getBoundingClientRect().top
    const list = canvas.getByRole("region", { name: "Extension navigation" })
    await expect(list.scrollHeight).toBeGreaterThan(list.clientHeight)
    list.scrollTop = list.scrollHeight
    await userEvent.click(canvas.getByRole("button", { name: "App 20" }))
    await expect(canvas.getByRole("heading")).toHaveTextContent("app-19/page")
    await expect(fixed.getBoundingClientRect().top).toBe(top)
    await expect(canvas.getByRole("button", { name: "App 20" })).toHaveAttribute("aria-current", "page")
    await expect(canvas.getByRole("button", { name: "Extensions" })).not.toHaveAttribute("aria-current")
  }
}

export const LeadingFeatures: Story = {
  args: { screen: "leading" },
  globals: { locale: "zh-CN" },
  render: function Render(args) {
    const [page, setPage] = useState<"vibemon" | "plugins" | "extensions" | "archives">("vibemon")
    return (
      <div className="bg-sidebar h-[640px]">
        <MainSidebarLayout
          {...args}
          leading={
            <>
              <LeadingNavigation
                activePage={page}
                onOpenVibemon={() => setPage("vibemon")}
                onOpenPlugins={() => setPage("plugins")}
                onOpenExtensions={() => setPage("extensions")}
                onOpenArchives={() => setPage("archives")}
              />
              <SidebarInset className="main-chat-surface p-8">
                <h1>{page}</h1>
              </SidebarInset>
            </>
          }
        />
      </div>
    )
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "插件" }))
    await expect(canvas.getByRole("heading")).toHaveTextContent("plugins")
    await expect(canvas.getByRole("button", { name: "插件" })).toHaveAttribute("aria-current", "page")
  }
}

export const English: Story = {
  globals: { locale: "en" },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const sidebar = canvasElement.querySelector(".main-sidebar-panel")!
      const main = canvasElement.querySelector('[data-screen-panel="main"]')!
      expect(sidebar.getBoundingClientRect().right).toBeCloseTo(main.getBoundingClientRect().left, 0)
      expect(getComputedStyle(main).direction).toBe("ltr")
    })
  }
}

export const Arabic: Story = {
  globals: { locale: "ar" },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const sidebar = canvasElement.querySelector(".main-sidebar-panel")!
      const main = canvasElement.querySelector('[data-screen-panel="main"]')!
      const viewport = canvasElement.querySelector('[data-slot="sidebar-wrapper"]')!
      expect(getComputedStyle(main).direction).toBe("rtl")
      expect(sidebar.getBoundingClientRect().left).toBeCloseTo(main.getBoundingClientRect().right, 0)
      expect(sidebar.getBoundingClientRect().right).toBeCloseTo(viewport.getBoundingClientRect().right, 0)
      expect(main.getBoundingClientRect().left).toBeCloseTo(viewport.getBoundingClientRect().left, 0)
    })
  }
}

export const ArabicActivity: Story = {
  args: { screen: "leading" },
  globals: { locale: "ar" },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const sidebar = canvasElement.querySelector(".main-sidebar-panel")!
      const leading = canvasElement.querySelector('[data-screen-panel="leading"]')!
      expect(sidebar.getBoundingClientRect().right).toBeCloseTo(leading.getBoundingClientRect().left, 0)
      expect(getComputedStyle(leading).direction).toBe("rtl")
    })
  }
}

export const ArabicFloatingSidebar: Story = {
  args: { initialPinned: false },
  globals: { locale: "ar" },
  play: async ({ canvasElement, userEvent }) => {
    const toggle = canvasElement.querySelector<HTMLButtonElement>(".main-sidebar-toggle button")!
    await userEvent.hover(toggle)
    await waitFor(() => {
      const sidebar = canvasElement.querySelector(".main-sidebar-panel")!
      const viewport = canvasElement.querySelector('[data-slot="sidebar-wrapper"]')!
      expect(viewport.getAttribute("data-sidebar-mode")).toBe("floating")
      expect(sidebar.getBoundingClientRect().right).toBeCloseTo(viewport.getBoundingClientRect().right, 0)
      expect(getComputedStyle(sidebar).visibility).toBe("visible")
    })
  }
}
