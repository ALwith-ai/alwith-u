import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, waitFor } from "storybook/test"

import { preparePreview } from "../../fixtures/prepare"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"
const meta = {
  id: "页面-辅助窗口-桌面宠物与气泡",
  title: "页面/其他/辅助窗口/桌面宠物与气泡",
  component: ProductPreview,
  loaders: [preparePreview],
  argTypes: productPreviewArgTypes,
  args: { page: "petBubble", width: 360, height: 320 },
  parameters: { layout: "fullscreen", productPage: true, a11y: { test: "todo" } }
} satisfies Meta<typeof ProductPreview>
export default meta
type Story = StoryObj<typeof meta>
export const Idle: Story = { name: "快捷回复 · 空闲" }
export const Running: Story = { name: "快捷回复 · 思考中", args: { bubbleCase: "running" } }
export const Permission: Story = { name: "快捷回复 · 等待授权", args: { bubbleCase: "permission" } }
export const Question: Story = { name: "快捷回复 · 等待回答", args: { bubbleCase: "question" } }
export const Error: Story = { name: "快捷回复 · 连接错误", args: { bubbleCase: "error" } }
export const ReadOnly: Story = { name: "快捷回复 · 只读", args: { bubbleCase: "readOnly" } }
export const Unavailable: Story = { name: "快捷回复 · 无会话", args: { bubbleCase: "unavailable" } }
export const Desktop: Story = {
  name: "桌面宠物 · 空闲",
  args: { page: "petWindow", petCase: "desktop", width: 200, height: 200 },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector("canvas")).not.toBeNull(), { timeout: 15000 })
  }
}
export const DesktopRunning: Story = {
  ...Desktop,
  name: "桌面宠物 · 工作中",
  args: { ...Desktop.args, bubbleCase: "running" }
}
export const DesktopPermission: Story = {
  ...Desktop,
  name: "桌面宠物 · 待确认",
  args: { ...Desktop.args, bubbleCase: "permission" }
}
