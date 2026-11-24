import type { ComponentProps } from "react"
import { within } from "storybook/test"

import { preparePreview } from "../../fixtures/prepare"
import preview from "../../preview"
import type { SharedMeta } from "../page-meta"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"

export const pageMeta = {
  loaders: [preparePreview],
  args: { page: "plugins" },
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
  id: "页面-插件-插件列表",
  title: "页面/负一屏/自定义/插件/插件列表",
  excludeStories: ["pageMeta"],
  component: ProductPreview,
  ...pageMeta
})

export const Marketplace = meta.story({ name: "插件市场" })

export const Installed = meta.story({
  name: "已安装插件与技能",
  args: { pluginSource: "personal" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      within(canvas.getByRole("navigation", { name: "已安装" })).getByRole("button", { name: "Spreadsheets" })
    )
  }
})

export const Empty = meta.story({ name: "插件与技能均为空", args: { pluginCase: "empty" } })

export const Loading = meta.story({ name: "加载中", args: { pluginCase: "loading" } })

export const Failed = meta.story({ name: "加载失败与重试", args: { pluginCase: "error" } })

export const NoResults = meta.story({
  name: "搜索无结果",
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByPlaceholderText(/搜索/), "no-match-plugin-937")
  }
})

export const Scrolling = meta.story({ name: "滚动加载远程插件", args: { pluginCase: "scroll" } })
