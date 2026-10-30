import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, waitFor, within } from "storybook/test"

import { preparePreview } from "../../fixtures/prepare"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"

const meta = {
  id: "页面-云盘",
  title: "页面/其他/云盘/页面状态",
  component: ProductPreview,
  loaders: [preparePreview],
  args: { page: "chat", chatCase: "project", sidebarView: "drive" },
  parameters: {
    layout: "fullscreen",
    productPage: true,
    a11y: { test: "todo" },
    docs: {
      description: {
        component:
          "Source components with isolated in-memory host data. Every example can be reset by selecting it again."
      }
    }
  },
  argTypes: productPreviewArgTypes
} satisfies Meta<typeof ProductPreview>
export default meta
type Story = StoryObj<typeof meta>

export const Projects: Story = { name: "项目与资料库", args: { driveCase: "ready" } }

export const Empty: Story = { name: "没有项目", args: { driveCase: "empty" } }

export const Unconfigured: Story = { name: "尚未配置", args: { driveCase: "unconfigured" } }

export const Offline: Story = { name: "连接断开", args: { driveCase: "offline" } }

export const Error: Story = { name: "同步错误", args: { driveCase: "error" } }

export const Paused: Story = { name: "同步暂停", args: { driveCase: "paused" } }

export const MassDelete: Story = { name: "批量删除云端文件确认", args: { driveCase: "massDelete" } }
export const MassDeleteError: Story = {
  name: "批量删除确认失败",
  args: { driveCase: "deleteError" },
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    const dialog = within(await body.findByRole("dialog"))
    await userEvent.click(dialog.getAllByRole("button").at(-1)!)
    await waitFor(async () => expect(await dialog.findByRole("alert")).toBeVisible())
  }
}
export const Syncing: Story = { name: "正在上传与下载", args: { driveCase: "syncing" } }
export const FailedUploads: Story = {
  name: "上传失败详情",
  args: { driveCase: "failedUploads" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "YUP Drive" }))
  }
}
export const Conflicts: Story = { ...FailedUploads, name: "文件冲突详情", args: { driveCase: "conflict" } }
