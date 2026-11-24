import type { ComponentProps } from "react"
import { expect, waitFor, within } from "storybook/test"

import { actionsTaken, client } from "../../fixtures/client"
import { openExternal } from "../../fixtures/open"
import { preparePreview } from "../../fixtures/prepare"
import preview from "../../preview"
import type { SharedMeta } from "../page-meta"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"

export const pageMeta = {
  argTypes: productPreviewArgTypes,
  loaders: [preparePreview],
  args: { page: "chat", chatCase: "permission" },
  parameters: { layout: "fullscreen", productPage: true, a11y: { test: "todo" } }
} satisfies SharedMeta<ComponentProps<typeof ProductPreview>>

// pageMeta is shared with derived files, not a story.
const meta = preview.meta({
  title: "流程/主窗聊天/确认与提问",
  excludeStories: ["pageMeta"],
  component: ProductPreview,
  ...pageMeta
})
export const Allow = meta.story({
  name: "工具请求 → 允许本次 → 继续执行",
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("option", { name: /允许本次操作/ }))
    await waitFor(() => expect(client.state.actions).toHaveLength(0))
    await canvas.findByText("已收到确认，交付清单已更新。")
  }
})
export const Always = meta.story({
  name: "工具请求 → 始终允许",
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("option", { name: /始终允许/ }))
    await waitFor(() =>
      expect(actionsTaken.some((item) => JSON.stringify(item.value).includes("allow_always"))).toBe(true)
    )
  }
})
export const Reject = meta.story({
  name: "工具请求 → 拒绝 → 取消执行",
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("option", { name: /拒绝/ }))
    await canvas.findByText("已取消本次操作，项目文件保持当前内容。")
  }
})
export const FormAccept = meta.story({
  name: "表单 → 填写 → 提交",
  args: { chatCase: "form" },
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    const dialog = within(await body.findByRole("dialog"))
    await userEvent.click(dialog.getByRole("radio", { name: /全部页面/ }))
    await userEvent.click(dialog.getByRole("button", { name: "提交" }))
    await waitFor(() => expect(client.state.actions).toHaveLength(0))
  }
})
export const FormDecline = meta.story({
  name: "表单 → 拒绝",
  args: { chatCase: "form" },
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    const dialog = within(await body.findByRole("dialog"))
    await userEvent.click(dialog.getByRole("button", { name: "拒绝" }))
    await waitFor(() => expect(client.state.actions).toHaveLength(0))
  }
})
export const FormCancel = meta.story({
  name: "表单 → 取消",
  args: { chatCase: "form" },
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    await body.findByRole("dialog")
    await userEvent.keyboard("{Escape}")
    await waitFor(() => expect(client.state.actions).toHaveLength(0))
  }
})
export const UrlOpen = meta.story({
  name: "连接授权 → 打开链接 → 等待服务确认",
  args: { chatCase: "url" },
  play: async ({ canvas, userEvent }) => {
    openExternal.mockClear()
    await userEvent.click(await canvas.findByRole("button", { name: /打开链接/ }))
    await expect(openExternal).toHaveBeenCalledWith("https://example.test/connect")
    await expect(client.state.actions).toHaveLength(1)
  }
})
export const UrlDecline = meta.story({
  name: "连接授权 → 拒绝",
  args: { chatCase: "url" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "拒绝" }))
    await waitFor(() => expect(client.state.actions).toHaveLength(0))
  }
})
export const UrlCancel = meta.story({
  name: "连接授权 → 取消",
  args: { chatCase: "url" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "取消" }))
    await waitFor(() => expect(client.state.actions).toHaveLength(0))
  }
})
export const Question = meta.story({
  name: "异步提问 → 选择与补充 → 提交",
  args: { chatCase: "question" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("radio", { name: "全部页面与流程" }))
    await userEvent.type(canvas.getByRole("textbox", { name: "补充说明" }), "本周五前交付")
    await userEvent.click(canvas.getByRole("button", { name: "提交" }))
    await waitFor(() => expect(client.state.actions).toHaveLength(0))
  }
})
