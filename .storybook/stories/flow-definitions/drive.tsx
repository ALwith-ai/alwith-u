import type { ComponentProps } from "react"
import { expect, within } from "storybook/test"

import { preparePreview } from "../../fixtures/prepare"
import preview from "../../preview"
import type { SharedMeta } from "../page-meta"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"
export const pageMeta = {
  argTypes: productPreviewArgTypes,
  loaders: [preparePreview],
  args: { page: "chat", chatCase: "project", sidebarView: "drive" },
  parameters: { layout: "fullscreen", productPage: true, a11y: { test: "todo" } }
} satisfies SharedMeta<ComponentProps<typeof ProductPreview>>

// pageMeta is shared with derived files, not a story.
const meta = preview.meta({
  title: "流程/其他/云盘与资料",
  excludeStories: ["pageMeta"],
  component: ProductPreview,
  ...pageMeta
})
export const Open = meta.story({
  name: "云盘 → 选择资料库 → 项目工作区",
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "品牌网站" }))
    await expect(canvas.getAllByRole("button", { name: "品牌网站" }).length).toBeGreaterThan(0)
  }
})
export const Create = meta.story({
  name: "云盘 → 新建 → 项目类型",
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await body.findByRole("button", { name: "新建" }))
    await body.findByRole("menu")
  }
})
export const Manage = meta.story({
  name: "资料库 → 更多 → 管理菜单",
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    // The row's more button stays display:none until the row is hovered, and synthetic hover does not apply
    // CSS :hover. A display:none element has no accessible name, so find it by its label instead of by role.
    await userEvent.click(await body.findByLabelText("产品资料库 更多", { selector: "button" }))
    await body.findByRole("menu")
  }
})
