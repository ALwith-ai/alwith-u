import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { expect, waitFor, within } from "storybook/test"

import { Button } from "@/components/ui/button"
import { Sidebar, SidebarFooter, SidebarInset } from "@/components/ui/sidebar"

import { ExtensionsSection } from "../../../src/features/extensions/extensions-section"
import { GuideButton } from "../../../src/features/guide/guide-button"
import { AppStatusBar } from "../../../src/features/layout/components/app-status-bar"
import { LeadingNavigation } from "../../../src/features/layout/components/leading-navigation"
import { type MainScreen, MainSidebarLayout } from "../../../src/features/layout/components/main-sidebar-layout"
import { PluginsPage } from "../../../src/features/plugins/plugins-page"
import { SidebarAccountMenu } from "../../../src/features/sessions/sidebar-account-menu"
import { preparePreview } from "../../fixtures/prepare"
import { ProductPreview } from "../product-preview"

function StartupNavigation(_props: Record<string, never>) {
  const [screen, setScreen] = useState<MainScreen>("main")
  return (
    <div className="h-[700px] bg-sidebar">
      <MainSidebarLayout
        initialPinned
        screen={screen}
        onScreenChange={setScreen}
        statusBar={
          <AppStatusBar
            end={
              <Button variant="ghost" size="sm" className="h-6 text-xs" aria-label="Chrome reference">
                Reference
              </Button>
            }
          />
        }
        sidebar={
          <Sidebar collapsible="none" className="h-full bg-transparent">
            <div className="flex-1 p-4">Navigation</div>
            <SidebarFooter>
              <div data-sidebar-footer-row className="flex items-center gap-0.5">
                <div className="min-w-0 flex-1">
                  <SidebarAccountMenu onOpenSettings={() => {}} onCreated={() => {}} />
                </div>
                <GuideButton />
              </div>
            </SidebarFooter>
          </Sidebar>
        }
        main={
          <SidebarInset className="main-chat-surface p-8">
            <h1>Chat</h1>
          </SidebarInset>
        }
        leading={
          <>
            <LeadingNavigation
              activePage="extensions"
              onOpenPlugins={() => {}}
              onOpenVibemon={() => {}}
              onOpenArchives={() => {}}
            />
            <SidebarInset className="main-chat-surface flex min-h-0 flex-col">
              <PluginsPage
                cwd={null}
                active={false}
                extensions={{ active: true, onOpen: () => {}, content: <ExtensionsSection /> }}
              />
            </SidebarInset>
          </>
        }
      />
    </div>
  )
}

const meta = {
  id: "startup-navigation",
  title: "页面/主窗整体/导航与项目/冷启动导航",
  component: StartupNavigation,
  tags: ["layout"],
  globals: { locale: "en" },
  loaders: [preparePreview],
  parameters: { layout: "fullscreen" }
} satisfies Meta<typeof StartupNavigation>
export default meta
type Story = StoryObj<typeof meta>

export const ListAlignment: Story = {
  name: "列表与侧栏两侧对齐",
  render: () => <ProductPreview page="chat" />,
  play: async ({ canvasElement, userEvent }) => {
    const tabs = await within(canvasElement).findByRole("tablist")
    const check = async () => {
      const viewport = canvasElement.querySelector<HTMLElement>(
        ".session-list-scroll [data-slot=scroll-area-viewport]"
      )!
      const content = viewport.firstElementChild!
      const outer = tabs.getBoundingClientRect()
      for (const element of [viewport, content]) {
        const bounds = element.getBoundingClientRect()
        await expect(Math.abs(bounds.left - outer.left)).toBeLessThan(1)
        await expect(Math.abs(bounds.right - outer.right)).toBeLessThan(1)
      }
    }
    await check()
    for (const tab of within(tabs).getAllByRole("tab").slice(0, 3)) {
      await userEvent.click(tab)
      await check()
    }
  }
}

export const ListAlignmentRtl: Story = {
  ...ListAlignment,
  name: "列表与侧栏两侧对齐 RTL",
  globals: { locale: "ar" }
}

export const Overview: Story = {
  name: "首次地图跳转",
  play: async ({ canvasElement, userEvent }) => {
    const panel = canvasElement.querySelector<HTMLElement>('[data-screen-panel="leading"]')!
    // The offscreen default page already has layout before the first navigation.
    await waitFor(() => expect(panel.querySelector("h1")).toHaveTextContent("Extensions"))
    await expect(panel.querySelector("h1")!.getBoundingClientRect().width).toBeGreaterThan(0)
    await expect(panel).toHaveAttribute("aria-hidden", "true")
    await userEvent.dblClick(canvasElement.querySelector(".main-window-statusbar")!)
    const target = canvasElement.querySelector<HTMLElement>('[data-atlas-overview-target="leading"]')!
    await expect(target.getBoundingClientRect().width).toBeGreaterThan(0)
    await userEvent.click(target)
    await waitFor(() => expect(panel).toHaveAttribute("aria-hidden", "false"))
    await expect(panel.inert).toBe(false)
    await expect(within(panel).getByRole("heading", { name: "Extensions" })).toBeVisible()
  }
}

export const AccountWidth: Story = {
  name: "个人中心与帮助菜单等宽",
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /林然/ }))
    const menu = await within(canvasElement.ownerDocument.body).findByRole("menu")
    const row = canvasElement.querySelector<HTMLElement>("[data-sidebar-footer-row]")!
    await waitFor(() => expect(menu.getBoundingClientRect().width).toBeCloseTo(row.clientWidth, 0))
    const width = menu.getBoundingClientRect().width
    await userEvent.keyboard("{Escape}")
    await waitFor(() => expect(within(canvasElement.ownerDocument.body).queryByRole("menu")).toBeNull())
    await userEvent.click(canvasElement.querySelector<HTMLElement>("[data-sidebar-footer-row] > button")!)
    const help = await within(canvasElement.ownerDocument.body).findByRole("menu")
    await waitFor(() => expect(help.getBoundingClientRect().width).toBeCloseTo(width, 0))
  }
}

export const AccountWidthRtl: Story = {
  ...AccountWidth,
  name: "个人中心与帮助菜单等宽 RTL",
  globals: { locale: "ar" }
}

export const SidebarGutters: Story = {
  name: "主屏与负一屏侧栏边距",
  play: async ({ canvasElement, userEvent }) => {
    const sidebar = canvasElement.querySelector<HTMLElement>(".main-sidebar-panel")!
    const content = sidebar.querySelector<HTMLElement>('[data-slot="sidebar"]')!
    const check = async () => {
      const outer = sidebar.getBoundingClientRect()
      const inner = content.getBoundingClientRect()
      await expect(outer.width).toBe(248)
      await expect(inner.left - outer.left).toBeCloseTo(4, 0)
      await expect(outer.right - inner.right).toBeCloseTo(4, 0)
      const host = canvasElement.querySelector<HTMLElement>("[data-main-screen]")!
      const bounds = host.getBoundingClientRect()
      const leading = host.dataset.mainScreen === "leading"
      const rtl = canvasElement.querySelector<HTMLElement>("[data-atlas-viewport]")!.dir === "rtl"
      const page = canvasElement
        .querySelector<HTMLElement>(`[data-screen-panel="${leading ? "leading" : "main"}"] > .main-chat-surface`)!
        .getBoundingClientRect()
      if (leading !== rtl) {
        await expect(bounds.right - outer.right).toBeCloseTo(4, 0)
        await expect(outer.left - page.right).toBeCloseTo(4, 0)
        await expect(inner.left - page.right).toBeCloseTo(bounds.right - inner.right, 0)
      } else {
        await expect(outer.left - bounds.left).toBeCloseTo(4, 0)
        await expect(page.left - outer.right).toBeCloseTo(4, 0)
        await expect(page.left - inner.right).toBeCloseTo(inner.left - bounds.left, 0)
      }
    }
    await waitFor(check)
    await userEvent.dblClick(canvasElement.querySelector(".main-window-statusbar")!)
    await userEvent.click(canvasElement.querySelector<HTMLElement>('[data-atlas-overview-target="leading"]')!)
    await waitFor(async () => {
      await expect(canvasElement.querySelector('[data-main-screen="leading"]')).not.toBeNull()
      await check()
    })
    const reference = canvasElement.querySelector<HTMLElement>('[aria-label="Chrome reference"]')!
    const status = canvasElement.querySelector<HTMLElement>(".desktop-status-item > button")!
    await expect(status.getBoundingClientRect().height).toBe(reference.getBoundingClientRect().height)
    for (const property of ["borderRadius", "paddingInlineStart", "paddingInlineEnd", "borderWidth"] as const) {
      await expect(getComputedStyle(status)[property]).toBe(getComputedStyle(reference)[property])
    }
  }
}

export const SidebarGuttersRtl: Story = {
  ...SidebarGutters,
  name: "主屏与负一屏侧栏边距 RTL",
  globals: { locale: "ar" }
}
