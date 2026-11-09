import type { Meta, StoryObj } from "@storybook/react-vite"
import { within } from "storybook/test"

import { dispatchCollection } from "../../../src/features/collection/store"
import { preparePreview } from "../../fixtures/prepare"
import { ProductPreview } from "../product-preview"

const meta = {
  id: "页面-主窗聊天-创建会话",
  title: "页面/主窗聊天/创建会话",
  component: ProductPreview,
  loaders: [preparePreview],
  args: { page: "chat", chatCase: "conversation" },
  parameters: { layout: "fullscreen", productPage: true, a11y: { test: "todo" } }
} satisfies Meta<typeof ProductPreview>
export default meta
type Story = StoryObj<typeof meta>

async function collection(context: Parameters<NonNullable<Story["play"]>>[0]) {
  await dispatchCollection({ type: "create", id: "create-session-example", name: "示例集合" })
  await dispatchCollection({ type: "add", collectionId: "create-session-example", sessionId: "conversation" })
  return within(context.canvasElement)
}

export const Sidebar: Story = {
  name: "侧栏 · 新聊天",
  play: async ({ canvas, userEvent }) => { await userEvent.click(await canvas.findByRole("button", { name: "新聊天" })) }
}
export const HeaderProject: Story = {
  name: "主窗顶部 · 项目中新聊天",
  play: async ({ canvasElement, userEvent }) => {
    const header = canvasElement.querySelector<HTMLElement>("[data-main-chat-header]")
    if (!header) throw new Error("Chat header is missing")
    await userEvent.click(await within(header).findByRole("button", { name: "产品工作台" }))
    await within(canvasElement.ownerDocument.body).findAllByRole("button", { name: "新聊天" })
  }
}
export const SidebarProject: Story = {
  name: "侧栏项目 · 项目中新聊天",
  play: async ({ canvasElement, userEvent }) => {
    const sidebar = canvasElement.querySelector<HTMLElement>(".main-sidebar-panel")
    if (!sidebar) throw new Error("Sidebar is missing")
    await userEvent.hover(await within(sidebar).findByRole("button", { name: "产品工作台" }))
    await within(canvasElement.ownerDocument.body).findAllByRole("button", { name: "新聊天" })
  }
}
export const Collection: Story = {
  name: "收藏集合 · 新对话", args: { sidebarView: "collections" },
  play: async (context) => {
    const canvas = await collection(context)
    const row = await canvas.findByRole("button", { name: "示例集合" })
    const button = row.parentElement?.querySelector<HTMLElement>('[aria-label="示例集合的更多操作"]')
    if (!button) throw new Error("Collection menu is missing")
    await context.userEvent.click(button)
    await within(context.canvasElement.ownerDocument.body).findByRole("menuitem", { name: "新对话" })
  }
}
