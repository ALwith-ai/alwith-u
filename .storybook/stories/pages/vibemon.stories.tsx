import type { ComponentProps } from "react"

import { preparePreview } from "../../fixtures/prepare"
import preview from "../../preview"
import type { SharedMeta } from "../page-meta"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"

export const pageMeta = {
  loaders: [preparePreview],
  args: { page: "vibemon" },
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
  id: "页面-vibémon",
  title: "页面/负一屏/宠物/页面状态",
  excludeStories: ["pageMeta"],
  component: ProductPreview,
  ...pageMeta
})

export const Home = meta.story({ name: "首页", args: { vibemonCase: "home" } })

export const Pull = meta.story({ name: "抽取页面", args: { vibemonCase: "pull" } })

export const Equip = meta.story({ name: "伙伴管理", args: { vibemonCase: "equip" } })

export const Empty = meta.story({ name: "未拥有伙伴", args: { vibemonCase: "empty" } })

export const Offline = meta.story({ name: "离线与重试", args: { vibemonCase: "offline" } })

export const SyncError = meta.story({ name: "资源同步失败", args: { vibemonCase: "syncError" } })

export const FirstVisit = meta.story({ name: "首次访问引导", args: { vibemonCase: "firstVisit" } })

export const Album = meta.story({
  name: "伙伴图鉴",
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Album" }))
  }
})
export const Insufficient = meta.story({ name: "积分不足", args: { vibemonCase: "insufficient" } })
export const DrawError = meta.story({
  name: "抽取失败",
  args: { vibemonCase: "drawError" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Pull once" }))
  }
})
