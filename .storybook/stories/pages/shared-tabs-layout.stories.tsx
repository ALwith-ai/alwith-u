import { createTabController, type TabItem } from "@alwith/module-tabs/core"
import { TabActionButton, TabStrip } from "@alwith/module-tabs/react"
import type { ComponentProps } from "react"

import preview from "../../preview"
import type { SharedMeta } from "../page-meta"
import "@alwith/module-tabs/styles.css"
import { Settings } from "lucide-react"
import { useEffect, useState } from "react"
import { expect, waitFor } from "storybook/test"

export function PageTabs() {
  const [controller] = useState(() =>
    createTabController({
      initial: {
        tabs: ["Overview", "Report", "Settings"].map((title): TabItem => ({
          id: title,
          title,
          transient: false,
          dirty: false,
          closable: true
        })),
        activeId: "Overview"
      }
    })
  )
  useEffect(() => () => controller.dispose(), [controller])
  return (
    <div style={{ width: 640, height: 160, margin: 24 }}>
      <TabStrip
        controller={controller}
        prefix="generic-pages"
        labels={{
          newTab: "Pages",
          close: "Close",
          closeOthers: "Close others",
          closeRight: "Close right",
          closeSaved: "Close unchanged",
          closeAll: "Close all"
        }}
        newTabAction={{
          label: "New page",
          onInvoke: () =>
            controller.insert({
              id: crypto.randomUUID(),
              title: "New page",
              transient: false,
              dirty: false,
              closable: true
            })
        }}
        trailing={
          <TabActionButton variant="ghost" size="icon-sm" className="alwith-tab-action" aria-label="Settings">
            <Settings className="size-4" />
          </TabActionButton>
        }
        onError={(error) => {
          throw error
        }}
      />
    </div>
  )
}
export const pageMeta = {
  tags: ["layout"],
  parameters: { layout: "fullscreen", a11y: { test: "off" } }
} satisfies SharedMeta<ComponentProps<typeof PageTabs>>

// pageMeta is shared with derived files, not a story.
const meta = preview.meta({
  title: "Shared/Tabs/Independent pages",
  excludeStories: ["pageMeta", "PageTabs"],
  component: PageTabs,
  ...pageMeta
})
export const WithoutEditor = meta.story({
  play: async ({ canvas, canvasElement, userEvent }) => {
    const tabs = canvas.getAllByRole("tab")
    void expect(tabs).toHaveLength(3)
    void expect(canvasElement.querySelector(".alwith-editor")).toBeNull()
    const rows = tabs.map((tab) => tab.closest<HTMLElement>("[data-tab-id]")!)
    await waitFor(() => {
      void expect(rows[0].getBoundingClientRect().height).toBe(32)
      void expect(rows[0].getBoundingClientRect().width).toBeGreaterThanOrEqual(90)
      void expect(rows[0].getBoundingClientRect().width).toBeLessThanOrEqual(240)
      void expect(rows[1].getBoundingClientRect().left - rows[0].getBoundingClientRect().right).toBeCloseTo(4, 1)
    })
    const add = canvas.getByRole("button", { name: "New page" })
    void expect(add.getBoundingClientRect().width).toBe(30)
    void expect(canvasElement.querySelector(".alwith-workspace-tab-scroll")!.contains(add)).toBe(false)
    for (let index = 0; index < 8; index++) await userEvent.click(add)
    await waitFor(() => {
      const scroll = canvasElement.querySelector<HTMLElement>(".alwith-workspace-tab-scroll")!
      void expect(scroll.scrollWidth).toBeGreaterThan(scroll.clientWidth)
      void expect(rows[0].getBoundingClientRect().width).toBe(90)
    })
    void expect(canvasElement.querySelector(".alwith-tab-controls")).toHaveAttribute("data-new-tab-docked", "true")
  }
})
