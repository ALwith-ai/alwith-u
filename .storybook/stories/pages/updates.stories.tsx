import type { Meta, StoryObj } from "@storybook/react-vite"

import { preparePreview } from "../../fixtures/prepare"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"
const meta = {
  id: "页面-设置-应用更新",
  title: "页面/设置页/应用更新",
  component: ProductPreview,
  loaders: [preparePreview],
  args: { page: "settings", settingsSection: "about" },
  parameters: { layout: "fullscreen", productPage: true, a11y: { test: "todo" } },
  argTypes: productPreviewArgTypes
} satisfies Meta<typeof ProductPreview>
export default meta
type Story = StoryObj<typeof meta>
export const Idle: Story = { name: "当前版本", args: { updateCase: "idle" } }
export const Disabled: Story = { name: "更新未配置", args: { updateCase: "disabled" } }
export const Checking: Story = { name: "检查更新中", args: { updateCase: "checkingForUpdates" } }
export const Downloading: Story = { name: "下载中 · 42%", args: { updateCase: "downloading" } }
export const Indeterminate: Story = { name: "下载中 · 未知大小", args: { updateCase: "indeterminate" } }
export const Ready: Story = { name: "下载完成 · 等待重启", args: { updateCase: "ready" } }
export const Restarting: Story = { name: "重启安装中", args: { updateCase: "restarting" } }
export const SidebarDownloading: Story = {
  name: "侧栏更新下载进度",
  args: { page: "chat", chatCase: "conversation", updateCase: "downloading" }
}
export const SidebarReady: Story = {
  name: "侧栏可安装更新",
  args: { page: "chat", chatCase: "conversation", updateCase: "ready" }
}
