import { openDiffModal } from "@alwith/module-chat/conversation"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { within } from "storybook/test"

import { openFilePreview } from "../../../src/features/chat/dialogs/file-preview-modal"
import { PROJECT_DIRECTORY } from "../../fixtures/catalog"
import { preparePreview } from "../../fixtures/prepare"
import { ProductPreview } from "../product-preview"
import { workflowAction } from "../workflow-driver"
const meta = {
  id: "页面-聊天-用量与诊断",
  title: "页面/主窗聊天/用量与诊断",
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
  play: async ({ canvas }) => {
    await canvas.findByRole("button", { name: "从原聊天继续" })
  }
}

export const ReadOnlyFile: Story = {
  name: "独立只读文件预览",
  play: async ({ canvasElement }) => {
    await workflowAction("打开只读文件预览", () => openFilePreview(`${PROJECT_DIRECTORY}/README.md`))
    await within(canvasElement.ownerDocument.body).findByRole("dialog")
  }
}
export const ImageFile: Story = {
  name: "独立只读图片预览",
  play: async ({ canvasElement }) => {
    await workflowAction("打开图片预览", () => openFilePreview(`${PROJECT_DIRECTORY}/assets/brand.svg`))
    await within(canvasElement.ownerDocument.body).findByRole("img")
  }
}
export const PreviewError: Story = {
  name: "独立文件预览失败",
  play: async ({ canvasElement }) => {
    await workflowAction("打开缺失文件", () => openFilePreview(`${PROJECT_DIRECTORY}/missing.txt`))
    await within(canvasElement.ownerDocument.body).findByRole("alert")
  }
}
export const DiffDialog: Story = {
  name: "文件差异弹窗",
  play: async ({ canvasElement }) => {
    await workflowAction("打开文件差异", () =>
      openDiffModal({
        path: "docs/交付清单.md",
        patch:
          "--- a/docs/交付清单.md\n+++ b/docs/交付清单.md\n@@ -1 +1,2 @@\n-待检查\n+已完成页面检查\n+文件预览已验证\n"
      })
    )
    await within(canvasElement.ownerDocument.body).findByRole("dialog")
  }
}
