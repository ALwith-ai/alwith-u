import type { Meta, StoryObj } from "@storybook/react-vite"
import { within } from "storybook/test"

import { preparePreview } from "../../fixtures/prepare"
import { ProductPreview } from "../product-preview"
const meta = {
  title: "流程/主窗聊天/用量与诊断",
  component: ProductPreview,
  loaders: [preparePreview],
  args: { page: "chat", chatCase: "conversation" },
  parameters: { layout: "fullscreen", productPage: true, a11y: { test: "todo" } }
} satisfies Meta<typeof ProductPreview>
export default meta
type Story = StoryObj<typeof meta>
export const Usage: Story = {
  name: "Token 用量详情",
  args: { chatDetail: "usage" },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.hover(await canvas.findByRole("button", { name: "Token 用量" }))
    await within(canvasElement.ownerDocument.body).findByText("上下文窗口")
  }
}
export const Warning: Story = { ...Usage, name: "上下文用量较高", args: { chatDetail: "usageWarning" } }
export const Full: Story = { ...Usage, name: "上下文窗口已满", args: { chatDetail: "usageFull" } }
export const ForkOrigin: Story = {
  name: "分支来源与返回原聊天",
  args: { chatCase: "files", chatDetail: "fork" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "从原聊天继续" }))
    await canvas.findByRole("button", { name: "打开聊天浮窗" })
  }
}
