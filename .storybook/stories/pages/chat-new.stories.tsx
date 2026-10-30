import type { Meta, StoryObj } from "@storybook/react-vite"

import { preparePreview } from "../../fixtures/prepare"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"

const meta = {
  id: "页面-聊天-新建聊天",
  title: "页面/主窗聊天/新建聊天",
  component: ProductPreview,
  loaders: [preparePreview],
  args: { page: "chat", chatCase: "welcome" },
  parameters: {
    layout: "fullscreen",
    productPage: true,
    a11y: { test: "todo" },
    docs: {
      description: {
        component:
          "Source components with isolated in-memory host data. Every example can be reset by selecting it again."
      }
    }
  },
  argTypes: productPreviewArgTypes
} satisfies Meta<typeof ProductPreview>
export default meta
type Story = StoryObj<typeof meta>

export const Welcome: Story = { name: "随聊 · 默认" }

export const Project: Story = { name: "项目 · 默认", args: { chatCase: "project" } }

export const FirstUse: Story = { name: "首次使用 · 无历史项目", args: { emptyThreads: true, emptyFiles: true } }

export const Preparing: Story = { name: "连接中", args: { connection: "connecting" } }

export const Disconnected: Story = { name: "连接断开", args: { connection: "disconnected" } }

export const Failed: Story = { name: "连接失败", args: { connection: "failed" } }

export const AuthRequired: Story = { name: "缺少模型登录", args: { draftFailure: "请先登录模型账号或配置供应商。" } }

export const FloatingSidebar: Story = { name: "侧栏收起", args: { sidebarPinned: false } }

export const Narrow: Story = { name: "窄窗口", args: { width: 760 } }
