import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, waitFor, within } from "storybook/test"

import { useChatWindowSurface } from "../../../src/lib/chat-window-state"
import { client } from "../../fixtures/client"
import { preparePreview } from "../../fixtures/prepare"
import { setTrailingScenario } from "../../fixtures/trailing-board"
import trailingBoard from "./trailing-board.stories"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"

const meta = {
  title: "页面/浮窗聊天/页面状态",
  component: ProductPreview,
  loaders: [preparePreview],
  args: { page: "floating" },
  parameters: {
    layout: "fullscreen",
    productPage: true,
    a11y: { test: "todo" },
    docs: { description: { component: "使用真实浮窗组件；仅在 Storybook 内准备会话和连接状态，不修改产品行为。" } }
  },
  argTypes: productPreviewArgTypes
} satisfies Meta<typeof ProductPreview>
export default meta
type Story = StoryObj<typeof meta>

const showPetSetup: NonNullable<Story["play"]> = async ({ canvas, userEvent }) => {
  const button = canvas.getByRole("button", { name: /^收起$/ })
  await waitFor(() => expect(button).toBeEnabled())
  await userEvent.click(button)
}

const showWindowMenu: NonNullable<Story["play"]> = async ({ canvas, userEvent, canvasElement }) => {
  const button = canvas.getByRole("button", { name: "更多操作" })
  await waitFor(() => expect(button).toBeEnabled())
  await userEvent.click(button)
  await waitFor(() => expect(canvasElement.ownerDocument.querySelector('[role="menu"]')).toBeVisible())
}

export const OpenFromSidebar: Story = {
  name: "01 侧栏入口 · 打开浮窗",
  parameters: { pageStateGroup: "会话入口/01 新建会话", docs: { description: { story: "点击主窗口侧栏顶部的浮窗按钮，打开或唤回浮窗；首次打开时新建浮窗聊天，不会转移主窗当前聊天。" } } },
  args: { page: "chat", chatCase: "conversation" }
}

export const OpenFromShortcut: Story = {
  name: "02 全局快捷键 · 打开浮窗",
  parameters: { pageStateGroup: "会话入口/01 新建会话", docs: { description: { story: "使用全局快捷键打开或唤回浮窗，默认 Option/Alt + Space；可在设置的通用页面修改或关闭。" } } },
  args: { page: "settings", settingsSection: "general" }
}

export const OpenFromPet: Story = {
  name: "03 双击桌宠 · 打开浮窗",
  parameters: { pageStateGroup: "会话入口/01 新建会话", docs: { description: { story: "双击桌宠，打开或唤回聊天浮窗。" } } },
  args: { page: "petWindow", petCase: "desktop", width: 200, height: 200 }
}

export const NewFromMenu: Story = {
  name: "04 浮窗菜单 · 新聊天或新建项目",
  parameters: { pageStateGroup: "会话入口/01 新建会话", docs: { description: { story: "在已有浮窗对话的更多操作中选择新聊天，或选择新建项目并选取文件夹，进入新的聊天草稿。" } } },
  args: { chatCase: "plainText" },
  play: showWindowMenu
}

export const NewFromProject: Story = {
  name: "05 浮窗项目菜单 · 项目中新聊天",
  parameters: { pageStateGroup: "会话入口/01 新建会话", docs: { description: { story: "在浮窗顶部打开项目菜单，选择新聊天，在当前项目中创建聊天草稿。" } } },
  args: { chatCase: "plainText" },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "产品工作台" }))
    await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "产品工作台" })
  }
}

export const OpenFromMainChat: Story = {
  name: "06 主窗聊天 · 移到浮窗",
  parameters: { pageStateGroup: "会话入口/02 打开已有会话", docs: { description: { story: "在主窗聊天的更多操作中选择移到浮窗，将当前聊天及输入草稿交接到浮窗。" } } },
  args: { page: "chat", chatCase: "conversation" },
  play: async ({ canvasElement, userEvent }) => {
    const header = canvasElement.querySelector<HTMLElement>("[data-main-chat-header]")
    if (!header) throw new Error("Chat header is missing")
    await userEvent.click(await within(header).findByRole("button", { name: "更多操作" }))
  }
}

export const OpenFromActivity: Story = {
  name: "07 活动列表 · 打开浮窗会话",
  parameters: { pageStateGroup: "会话入口/02 打开已有会话", docs: { description: { story: "在活动列表点击带浮窗标记的会话，唤回浮窗并打开该会话。" } } },
  args: { page: "chat", sidebarView: "activity", chatCase: "conversation", floatingChatCase: "running" },
  beforeEach: async () => {
    client.store.setState((state) => ({ sessionWindows: { ...state.sessionWindows, running: "chat" } }))
    useChatWindowSurface.setState({ sessionId: "running", visible: false })
  }
}

export const OpenFromProject: Story = {
  name: "08 浮窗项目菜单 · 切换已有聊天",
  parameters: { pageStateGroup: "会话入口/02 打开已有会话", docs: { description: { story: "在浮窗顶部打开项目菜单，选择项目中的已有聊天，在浮窗内切换并打开该会话。" } } },
  args: { chatCase: "plainText" },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "产品工作台" }))
    await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "产品工作台" })
  }
}

export const OpenFromWindowCard: Story = {
  name: "09 右侧隐藏屏 · 浮窗卡片",
  parameters: { pageStateGroup: "会话入口/02 打开已有会话", docs: { description: { story: "浮窗可见时，右侧隐藏屏的工具窗口区域显示聊天窗口卡片，点击卡片唤回浮窗。" } } },
  loaders: [async (context) => { await preparePreview(context); setTrailingScenario({ apps: [], windows: ["chat"] }); return {} }],
  render: () => <trailingBoard.component apps={[]} windows={["chat"]} petCase="home" authenticated />
}

export const FloatingDraft: Story = {
  name: "新建聊天 · 浮窗整体样式",
  parameters: { pageStateGroup: "02 整体样式" },
  args: { chatCase: "welcome" }
}

export const FloatingConversation: Story = {
  name: "已有对话 · 浮窗整体样式",
  parameters: { pageStateGroup: "02 整体样式" },
  args: { chatCase: "plainText" }
}

export const FloatingDraftMenu: Story = {
  name: "新建聊天 · 展开更多菜单",
  parameters: { pageStateGroup: "03 更多操作菜单", docs: { description: { story: "浮窗菜单提供新建项目、回到聊天主窗等操作；项目路径可用默认应用打开。与主窗共用的操作见主窗聊天。" } } },
  args: { chatCase: "welcome" },
  play: showWindowMenu
}

export const FloatingConversationMenu: Story = {
  name: "已有对话 · 展开更多菜单",
  parameters: { pageStateGroup: "03 更多操作菜单", docs: { description: { story: "已有对话时可在浮窗中新建聊天或新建项目，也可将当前聊天和草稿移回主窗。重命名、查找和删除等共用操作见主窗聊天。" } } },
  args: { chatCase: "plainText" },
  play: showWindowMenu
}

export const FloatingDisconnected: Story = {
  name: "连接异常 · 浮窗顶部重连提示",
  parameters: { pageStateGroup: "04 连接提醒", docs: { description: { story: "浮窗已打开后，连接断开、连接失败或当前会话尚未载入时，顶部均显示同一条连接中断提示和重新连接按钮；这里用连接断开展示，不重复列出相同界面。" } } },
  args: { chatCase: "plainText", connection: "disconnected" }
}

export const FloatingCollapsedPet: Story = {
  name: "已装扮桌宠 · 收起后的桌宠",
  parameters: { pageStateGroup: "05 收起为桌宠", docs: { description: { story: "已装扮桌宠时点击浮窗顶部的收起按钮，浮窗隐藏，桌面显示桌宠。此示例展示收起后真实桌宠窗口的内容；桌面背景和原生窗口位置由系统提供。" } } },
  args: { page: "petWindow", petCase: "desktop", width: 200, height: 200 },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector("canvas")).not.toBeNull(), { timeout: 15000 })
  }
}

export const FloatingDrawPet: Story = {
  name: "没有桌宠 · 提示前往抽取",
  parameters: { pageStateGroup: "05 收起为桌宠" },
  args: { chatCase: "plainText", petCase: "empty" },
  play: showPetSetup
}

export const FloatingEquipPet: Story = {
  name: "未装扮桌宠 · 提示前往装扮",
  parameters: { pageStateGroup: "05 收起为桌宠" },
  args: { chatCase: "plainText", petCase: "home" },
  play: showPetSetup
}
