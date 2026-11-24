import type { ComponentProps } from "react"

import { preparePreview } from "../../fixtures/prepare"
import preview from "../../preview"
import type { SharedMeta } from "../page-meta"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"

export const pageMeta = {
  argTypes: productPreviewArgTypes,
  loaders: [preparePreview],
  args: { page: "vibemonBubble", width: 360, height: 320 },
  parameters: { layout: "fullscreen", productPage: true, a11y: { test: "todo" } }
} satisfies SharedMeta<ComponentProps<typeof ProductPreview>>

// pageMeta is shared with derived files, not a story.
const meta = preview.meta({
  title: "流程/其他/桌面Vibémon快捷回复",
  excludeStories: ["pageMeta"],
  component: ProductPreview,
  ...pageMeta
})
export const Send = meta.story({
  name: "输入消息 → 思考 → 回复结果",
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(await canvas.findByRole("textbox", { name: "随心输入" }), "请更新交付清单。")
    await userEvent.click(canvas.getByRole("button", { name: "发送" }))
    await canvas.findByText("已更新交付清单，可以继续打开项目查看。")
  }
})
export const Allow = meta.story({
  name: "权限请求 → 允许 → 继续处理",
  args: { bubbleCase: "permission" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "允许" }))
    await canvas.findByRole("textbox", { name: "随心输入" })
  }
})
export const Reject = meta.story({
  name: "权限请求 → 拒绝 → 回到输入",
  args: { bubbleCase: "permission" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "拒绝" }))
    await canvas.findByRole("textbox", { name: "随心输入" })
  }
})
export const Answer = meta.story({
  name: "澄清问题 → 选择范围 → 回到输入",
  args: { bubbleCase: "question" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "全部页面与流程" }))
    await canvas.findByRole("textbox", { name: "随心输入" })
  }
})
