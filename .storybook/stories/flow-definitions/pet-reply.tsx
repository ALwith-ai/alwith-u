import type { Meta, StoryObj } from "@storybook/react-vite"

import { preparePreview } from "../../fixtures/prepare"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"

const meta = {
  title: "流程/其他/桌面宠物快捷回复",
  component: ProductPreview,
  argTypes: productPreviewArgTypes,
  loaders: [preparePreview],
  args: { page: "petBubble", width: 360, height: 320 },
  parameters: { layout: "fullscreen", productPage: true, a11y: { test: "todo" } }
} satisfies Meta<typeof ProductPreview>
export default meta
type Story = StoryObj<typeof meta>
export const Send: Story = {
  name: "输入消息 → 思考 → 回复结果",
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(await canvas.findByRole("textbox", { name: "随心输入" }), "请更新交付清单。")
    await userEvent.click(canvas.getByRole("button", { name: "发送" }))
    await canvas.findByText("已更新交付清单，可以继续打开项目查看。")
  }
}
export const Allow: Story = {
  name: "权限请求 → 允许 → 继续处理",
  args: { bubbleCase: "permission" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "允许" }))
    await canvas.findByRole("textbox", { name: "随心输入" })
  }
}
export const Reject: Story = {
  name: "权限请求 → 拒绝 → 回到输入",
  args: { bubbleCase: "permission" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "拒绝" }))
    await canvas.findByRole("textbox", { name: "随心输入" })
  }
}
export const Answer: Story = {
  name: "澄清问题 → 选择范围 → 回到输入",
  args: { bubbleCase: "question" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "全部页面与流程" }))
    await canvas.findByRole("textbox", { name: "随心输入" })
  }
}
