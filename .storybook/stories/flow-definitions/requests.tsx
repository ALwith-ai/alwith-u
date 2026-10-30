import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, waitFor, within } from "storybook/test"

import { actionsTaken, client } from "../../fixtures/client"
import { openExternal } from "../../fixtures/open"
import { preparePreview } from "../../fixtures/prepare"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"

const meta = {
  title: "流程/主窗聊天/确认与提问",
  component: ProductPreview,
  argTypes: productPreviewArgTypes,
  loaders: [preparePreview],
  args: { page: "chat", chatCase: "permission" },
  parameters: { layout: "fullscreen", productPage: true, a11y: { test: "todo" } }
} satisfies Meta<typeof ProductPreview>
export default meta
type Story = StoryObj<typeof meta>
export const Allow: Story = {
  name: "工具请求 → 允许本次 → 继续执行",
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("option", { name: /允许本次操作/ }))
    await waitFor(() => expect(client.state.actions).toHaveLength(0))
    await canvas.findByText("已收到确认，交付清单已更新。")
  }
}
export const Always: Story = {
  name: "工具请求 → 始终允许",
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("option", { name: /始终允许/ }))
    await waitFor(() =>
      expect(actionsTaken.some((item) => JSON.stringify(item.value).includes("allow_always"))).toBe(true)
    )
  }
}
export const Reject: Story = {
  name: "工具请求 → 拒绝 → 取消执行",
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("option", { name: /拒绝/ }))
    await canvas.findByText("已取消本次操作，项目文件保持当前内容。")
  }
}
export const FormAccept: Story = {
  name: "表单 → 填写 → 提交",
  args: { chatCase: "form" },
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    const dialog = within(await body.findByRole("dialog"))
    await userEvent.click(dialog.getByRole("radio", { name: /全部页面/ }))
    await userEvent.click(dialog.getByRole("button", { name: "提交" }))
    await waitFor(() => expect(client.state.actions).toHaveLength(0))
  }
}
export const FormDecline: Story = {
  name: "表单 → 拒绝",
  args: { chatCase: "form" },
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    const dialog = within(await body.findByRole("dialog"))
    await userEvent.click(dialog.getByRole("button", { name: "拒绝" }))
    await waitFor(() => expect(client.state.actions).toHaveLength(0))
  }
}
export const FormCancel: Story = {
  name: "表单 → 取消",
  args: { chatCase: "form" },
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    await body.findByRole("dialog")
    await userEvent.keyboard("{Escape}")
    await waitFor(() => expect(client.state.actions).toHaveLength(0))
  }
}
export const UrlOpen: Story = {
  name: "连接授权 → 打开链接 → 等待服务确认",
  args: { chatCase: "url" },
  play: async ({ canvas, userEvent }) => {
    openExternal.mockClear()
    await userEvent.click(await canvas.findByRole("button", { name: /打开链接/ }))
    await expect(openExternal).toHaveBeenCalledWith("https://example.test/connect")
    await expect(client.state.actions).toHaveLength(1)
  }
}
export const UrlDecline: Story = {
  name: "连接授权 → 拒绝",
  args: { chatCase: "url" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "拒绝" }))
    await waitFor(() => expect(client.state.actions).toHaveLength(0))
  }
}
export const UrlCancel: Story = {
  name: "连接授权 → 取消",
  args: { chatCase: "url" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "取消" }))
    await waitFor(() => expect(client.state.actions).toHaveLength(0))
  }
}
export const Question: Story = {
  name: "异步提问 → 选择与补充 → 发送",
  args: { chatCase: "question" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("radio", { name: "全部页面与流程" }))
    await userEvent.click(canvas.getAllByRole("button", { name: "提交回答" })[0]!)
    await waitFor(() => expect(actionsTaken.some((action) => action.type === "prompt")).toBe(true))
  }
}
