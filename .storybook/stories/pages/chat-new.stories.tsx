import type { ComponentProps } from "react"

import { preparePreview } from "../../fixtures/prepare"
import preview from "../../preview"
import type { SharedMeta } from "../page-meta"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"

export const pageMeta = {
  loaders: [preparePreview],
  args: { page: "chat", chatCase: "welcome" },
  parameters: {
    layout: "fullscreen",
    productPage: true,
    a11y: { test: "todo" },
    docs: {
      description: {
        component: "使用真实产品组件和独立的内存模拟数据。重新选择示例即可重置页面状态。"
      }
    }
  },
  argTypes: productPreviewArgTypes
} satisfies SharedMeta<ComponentProps<typeof ProductPreview>>

// pageMeta is shared with derived files, not a story.
const meta = preview.meta({
  id: "页面-聊天-新建聊天",
  title: "页面/主窗聊天/新建聊天",
  excludeStories: ["pageMeta"],
  component: ProductPreview,
  ...pageMeta
})

export const Welcome = meta.story({ name: "随聊 · 默认" })

export const Project = meta.story({ name: "项目 · 默认", args: { chatCase: "project" } })

export const FirstUse = meta.story({ name: "首次使用 · 无历史项目", args: { emptyThreads: true, emptyFiles: true } })

export const Preparing = meta.story({ name: "连接中", args: { connection: "connecting" } })

export const Disconnected = meta.story({ name: "连接断开", args: { connection: "disconnected" } })

export const Failed = meta.story({ name: "连接失败", args: { connection: "failed" } })

export const AuthRequired = meta.story({
  name: "缺少模型登录",
  args: { draftFailure: "请先登录模型账号或配置供应商。" }
})

export const FloatingSidebar = meta.story({ name: "侧栏收起", args: { sidebarPinned: false } })

export const Narrow = meta.story({ name: "窄窗口", args: { width: 760 } })
