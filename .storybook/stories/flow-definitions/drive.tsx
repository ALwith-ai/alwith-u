import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, within } from "storybook/test"

import { preparePreview } from "../../fixtures/prepare"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"
const meta = {
  title: "流程/其他/云盘与资料",
  component: ProductPreview,
  argTypes: productPreviewArgTypes,
  loaders: [preparePreview],
  args: { page: "chat", chatCase: "project", sidebarView: "drive" },
  parameters: { layout: "fullscreen", productPage: true, a11y: { test: "todo" } }
} satisfies Meta<typeof ProductPreview>
export default meta
type Story = StoryObj<typeof meta>
export const Open: Story = {
  name: "云盘 → 选择资料库 → 项目工作区",
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "品牌网站" }))
    await expect(canvas.getAllByRole("button", { name: "品牌网站" }).length).toBeGreaterThan(0)
  }
}
export const Create: Story = {
  name: "云盘 → 新建 → 项目类型",
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await body.findByRole("button", { name: "新建" }))
    await body.findByRole("menu")
  }
}
export const Manage: Story = {
  name: "资料库 → 更多 → 管理菜单",
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await body.findByRole("button", { name: "产品资料库 更多" }))
    await body.findByRole("menu")
  }
}
