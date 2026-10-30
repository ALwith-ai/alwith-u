import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, waitFor, within } from "storybook/test"

import { actionsTaken, client } from "../../fixtures/client"
import { preparePreview } from "../../fixtures/prepare"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"

const meta = {
  title: "流程/主窗聊天/输入与确认",
  component: ProductPreview,
  loaders: [preparePreview],
  args: { page: "chat", chatCase: "conversation" },
  argTypes: productPreviewArgTypes,
  parameters: { layout: "fullscreen", productPage: true, a11y: { test: "todo" } }
} satisfies Meta<typeof ProductPreview>
export default meta
type Story = StoryObj<typeof meta>
export const PermissionMode: Story = {
  name: "权限菜单 → 完全访问 → 应用",
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: /^切换权限模式/ }))
    await userEvent.click(
      await within(canvasElement.ownerDocument.body).findByRole("menuitemradio", { name: /完全访问/ })
    )
    await waitFor(() =>
      expect(
        client.session("conversation").configOptions.find((option) => option.category === "mode")?.currentValue
      ).toBe("agent-full-access")
    )
  }
}
export const FileMention: Story = {
  name: "引用项目文件 → 发送上下文 → 完成",
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.type(await canvas.findByRole("textbox", { name: "发送消息" }), "@README")
    await userEvent.click(await within(canvasElement.ownerDocument.body).findByRole("option", { name: /README.md/ }))
    await userEvent.click(canvas.getByRole("button", { name: "发送" }))
    await waitFor(() =>
      expect(
        actionsTaken.some(
          (action) => action.type === "prompt" && JSON.stringify(action.value).includes('"type":"resource_link"')
        )
      ).toBe(true)
    )
    await canvas.findByText(/检查已完成，交付清单已更新/)
  }
}
export const TextAttachmentRetry: Story = {
  name: "长文本 → 写入失败 → 重试 → 发送",
  args: { composerCase: "textError" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("textbox", { name: "发送消息" }))
    await userEvent.paste("Delivery checklist. ".repeat(300))
    await canvas.findByText("文件创建失败")
    await userEvent.click(canvas.getByRole("button", { name: "重试创建文本附件" }))
    await canvas.findByText("6000 个字符")
    await userEvent.click(canvas.getByRole("button", { name: "发送" }))
    await canvas.findByText(/检查已完成，交付清单已更新/)
  }
}
export const Prediction: Story = {
  name: "输入建议 → Tab 接受 → 发送",
  args: { composerCase: "prediction" },
  play: async ({ canvas, userEvent }) => {
    const input = await canvas.findByPlaceholderText("请继续核对文件预览")
    await userEvent.click(input)
    await userEvent.keyboard("{Tab}")
    await expect(input).toHaveValue("请继续核对文件预览")
    await userEvent.click(canvas.getByRole("button", { name: "发送" }))
    await canvas.findByText(/检查已完成，交付清单已更新/)
  }
}
export const GlobalForms: Story = {
  name: "全局表单队列 → 取消当前 → 提交下一份",
  args: { globalAction: "multipleForms" },
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    await body.findByRole("dialog")
    await userEvent.keyboard("{Escape}")
    await waitFor(() => expect(client.state.actions).toHaveLength(1))
    const dialog = within(await body.findByRole("dialog"))
    await userEvent.click(dialog.getByRole("radio", { name: /全部页面/ }))
    await userEvent.click(dialog.getByRole("button", { name: "提交" }))
    await waitFor(() => expect(client.state.actions).toHaveLength(0))
  }
}
