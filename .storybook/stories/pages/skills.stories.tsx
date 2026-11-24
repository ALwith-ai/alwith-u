import type { ComponentProps } from "react"

import { preparePreview } from "../../fixtures/prepare"
import preview from "../../preview"
import type { SharedMeta } from "../page-meta"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"

export const pageMeta = {
  loaders: [preparePreview],
  args: { page: "plugins" },
  argTypes: productPreviewArgTypes,
  parameters: { layout: "fullscreen", productPage: true, a11y: { test: "todo" } }
} satisfies SharedMeta<ComponentProps<typeof ProductPreview>>

// pageMeta is shared with derived files, not a story.
const meta = preview.meta({
  id: "页面-技能",
  title: "页面/负一屏/自定义/技能/页面状态",
  excludeStories: ["pageMeta"],
  component: ProductPreview,
  ...pageMeta
})

export const List = meta.story({
  name: "技能列表",
  parameters: { pageStateGroup: "技能状态" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "技能" }))
    await canvas.findByPlaceholderText("搜索技能")
  }
})
export const Empty = meta.story({
  name: "没有技能",
  parameters: { pageStateGroup: "技能状态" },
  args: { pluginCase: "empty" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "技能" }))
    await canvas.findByText("找不到技能")
  }
})
export const NoResults = meta.story({
  name: "搜索无结果",
  parameters: { pageStateGroup: "技能状态" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "技能" }))
    await userEvent.type(await canvas.findByPlaceholderText("搜索技能"), "no-match-skill-937")
  }
})
