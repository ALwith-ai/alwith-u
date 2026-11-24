import type { ComponentProps } from "react"
import { within } from "storybook/test"

import { dispatchCollection } from "../../../src/features/collection/store"
import { preparePreview } from "../../fixtures/prepare"
import preview from "../../preview"
import type { SharedMeta, SharedPlay } from "../page-meta"
import { ProductPreview } from "../product-preview"

export const pageMeta = {
  loaders: [preparePreview],
  args: { page: "chat", chatCase: "conversation" },
  parameters: { layout: "fullscreen", productPage: true, a11y: { test: "todo" } }
} satisfies SharedMeta<ComponentProps<typeof ProductPreview>>

// pageMeta is shared with derived files, not a story.
const meta = preview.meta({
  id: "页面-主窗聊天-创建会话",
  title: "页面/主窗聊天/创建会话",
  excludeStories: ["pageMeta"],
  component: ProductPreview,
  ...pageMeta
})
type Play = SharedPlay<ComponentProps<typeof ProductPreview>>

async function collection(context: Parameters<Play>[0]) {
  await dispatchCollection({ type: "create", id: "create-session-example", name: "示例集合" })
  await dispatchCollection({ type: "add", collectionId: "create-session-example", sessionId: "conversation" })
  return within(context.canvasElement)
}

export const Sidebar = meta.story({
  name: "侧栏 · 新聊天",
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "新聊天" }))
  }
})
export const HeaderProject = meta.story({
  name: "主窗顶部 · 项目中新聊天",
  play: async ({ canvasElement, userEvent }) => {
    const header = canvasElement.querySelector<HTMLElement>("[data-main-chat-header]")
    if (!header) throw new Error("Chat header is missing")
    await userEvent.click(await within(header).findByRole("button", { name: "产品工作台" }))
    await within(canvasElement.ownerDocument.body).findAllByRole("button", { name: "新聊天" })
  }
})
export const SidebarProject = meta.story({
  name: "侧栏项目 · 项目中新聊天",
  play: async ({ canvasElement, userEvent }) => {
    const sidebar = canvasElement.querySelector<HTMLElement>(".main-sidebar-panel")
    if (!sidebar) throw new Error("Sidebar is missing")
    await userEvent.hover(await within(sidebar).findByRole("button", { name: "产品工作台" }))
    await within(canvasElement.ownerDocument.body).findAllByRole("button", { name: "新聊天" })
  }
})
export const Collection = meta.story({
  name: "收藏集合 · 新对话",
  args: { sidebarView: "collections" },
  play: async (context) => {
    const canvas = await collection(context)
    const row = await canvas.findByRole("button", { name: "示例集合" })
    const button = row.parentElement?.querySelector<HTMLElement>('[aria-label="示例集合的更多操作"]')
    if (!button) throw new Error("Collection menu is missing")
    await context.userEvent.click(button)
    await within(context.canvasElement.ownerDocument.body).findByRole("menuitem", { name: "新对话" })
  }
})
