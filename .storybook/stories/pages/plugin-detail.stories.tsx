import type { ComponentProps } from "react"

import { preparePreview } from "../../fixtures/prepare"
import preview from "../../preview"
import type { SharedMeta } from "../page-meta"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"

export const pageMeta = {
  loaders: [preparePreview],
  args: { page: "pluginDetail" },
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
  id: "页面-插件-插件详情",
  title: "页面/负一屏/自定义/插件/插件详情",
  excludeStories: ["pageMeta"],
  component: ProductPreview,
  ...pageMeta
})

export const Available = meta.story({ name: "未安装 · 详情与能力" })

export const Installed = meta.story({ name: "已安装远程插件 · 卸载", args: { pluginCase: "installed" } })

export const Unavailable = meta.story({ name: "不可用 · 套餐限制", args: { pluginCase: "unavailable" } })

export const Failed = meta.story({ name: "详情加载失败", args: { pluginCase: "detailError" } })
