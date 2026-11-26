import type { ComponentProps } from "react"
import { within } from "storybook/test"

import { client } from "../../fixtures/client"
import { preparePreview } from "../../fixtures/prepare"
import preview from "../../preview"
import type { SharedMeta } from "../page-meta"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"
import { typeInComposer } from "../type-in-composer"

export const pageMeta = {
  loaders: [preparePreview],
  args: { page: "chat", chatCase: "conversation" },
  argTypes: productPreviewArgTypes,
  parameters: { layout: "fullscreen", productPage: true, a11y: { test: "todo" } }
} satisfies SharedMeta<ComponentProps<typeof ProductPreview>>

// pageMeta is shared with derived files, not a story.
const meta = preview.meta({
  id: "页面-聊天-输入与附件状态",
  title: "页面/主窗聊天/输入与附件状态",
  excludeStories: ["pageMeta"],
  component: ProductPreview,
  ...pageMeta
})
export const PermissionMenu = meta.story({
  name: "权限模式菜单",
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: /^切换权限模式/ }))
    await within(canvasElement.ownerDocument.body).findByText("完全访问")
  }
})
export const ImageAdded = meta.story({
  name: "添加图片附件",
  play: async ({ canvasElement, userEvent }) => {
    const input = canvasElement.querySelector<HTMLInputElement>('input[type="file"]')!
    const image = canvasElement.ownerDocument.createElement("canvas")
    image.width = 64
    image.height = 64
    image.getContext("2d")!.fillRect(0, 0, 64, 64)
    const blob = await new Promise<Blob>((resolve) => image.toBlob((blob) => resolve(blob!), "image/png"))
    await userEvent.upload(input, new File([blob], "preview.png", { type: "image/png" }))
    await within(canvasElement).findByRole("button", { name: "移除附件" })
  }
})
export const ImageLimit = meta.story({
  name: "图片总大小超限",
  play: async ({ canvasElement, userEvent }) => {
    await userEvent.upload(
      canvasElement.querySelector<HTMLInputElement>('input[type="file"]')!,
      new File([new Uint8Array(21 * 1024 * 1024)], "large.png", { type: "image/png" })
    )
    await within(canvasElement.ownerDocument.body).findByText("图片附件过大")
  }
})
export const UnsupportedAttachment = meta.story({
  name: "不支持的附件格式",
  play: async ({ canvasElement, userEvent }) => {
    const input = canvasElement.querySelector<HTMLInputElement>('input[type="file"]')!
    input.removeAttribute("accept")
    await userEvent.upload(input, new File(["demo"], "demo.pdf", { type: "application/pdf" }))
    await within(canvasElement.ownerDocument.body).findByText("只支持图片附件")
  }
})
export const Mention = meta.story({
  name: "文件引用 · 搜索并选择",
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.type(await canvas.findByRole("textbox", { name: "发送消息" }), "@README")
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await body.findByRole("option", { name: /README.md/ }))
    await canvas.findByRole("button", { name: /移除.*README/ })
  }
})
export const MentionEmpty = meta.story({
  name: "文件引用 · 无匹配",
  args: { composerCase: "mentionEmpty" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(await canvas.findByRole("textbox", { name: "发送消息" }), "@missing")
    await canvas.findByText("没有匹配的文件")
  }
})
export const MentionError = meta.story({
  name: "文件引用 · 搜索失败",
  args: { composerCase: "mentionError" },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.type(await canvas.findByRole("textbox", { name: "发送消息" }), "@README")
    await within(canvasElement.ownerDocument.body).findAllByText("模拟文件搜索失败")
  }
})
export const LongText = meta.story({
  name: "长文本转为附件",
  play: async ({ canvas, userEvent }) => {
    const input = await canvas.findByRole("textbox", { name: "发送消息" })
    await userEvent.click(input)
    await userEvent.paste("Delivery checklist. ".repeat(300))
    await canvas.findByText("6000 个字符")
  }
})
export const LongTextPending = meta.story({
  ...LongText.input,
  name: "长文本附件 · 写入中",
  args: { composerCase: "textPending" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("textbox", { name: "发送消息" }))
    await userEvent.paste("Delivery checklist. ".repeat(300))
    await canvas.findByText("正在添加粘贴的文本…")
  }
})
export const LongTextError = meta.story({
  ...LongTextPending.input,
  name: "长文本附件 · 写入失败",
  args: { composerCase: "textError" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("textbox", { name: "发送消息" }))
    await userEvent.paste("Delivery checklist. ".repeat(300))
    await canvas.findByText("文件创建失败")
  }
})
export const Prediction = meta.story({
  name: "输入预测 · 待接受",
  args: { composerCase: "prediction" },
  play: async ({ canvas }) => {
    await canvas.findByPlaceholderText("请继续核对文件预览")
  }
})
export const TextInput = meta.story({
  name: "文本输入",
  parameters: { pageStateGroup: "01 输入内容/01 文本输入" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(await canvas.findByRole("textbox", { name: "发送消息" }), "请整理本周的交付进度。")
  }
})

export const ModelPicker = meta.story({
  name: "模型选择菜单",
  parameters: { pageStateGroup: "02 输入框功能/02 模型选择" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("model-trigger"))
  }
})

export const SlashCommands = meta.story({
  name: "斜杠命令菜单",
  parameters: { pageStateGroup: "01 输入内容/01 文本输入" },
  play: async ({ canvas }) => {
    client.store.setState((state) => ({
      sessions: {
        ...state.sessions,
        conversation: {
          ...state.sessions.conversation,
          commands: [{ type: "command", name: "plan", description: "Plan a task" }]
        }
      }
    }))
    typeInComposer(await canvas.findByRole("textbox", { name: "发送消息" }), "/")
    await canvas.findByRole("listbox")
  }
})

export const MentionSearch = meta.story({
  name: "文件引用 · 搜索",
  parameters: { pageStateGroup: "01 输入内容/03 文件引用" },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.type(await canvas.findByRole("textbox", { name: "发送消息" }), "@README")
    await within(canvasElement.ownerDocument.body).findByRole("option", { name: /README.md/ })
  }
})

export const SendEmpty = meta.story({
  name: "输入为空 · 无法发送",
  parameters: { pageStateGroup: "02 输入框功能/05 发送与停止" }
})

export const StopRunning = meta.story({
  name: "执行中 · 停止生成",
  parameters: { pageStateGroup: "02 输入框功能/05 发送与停止" },
  args: { chatCase: "running" }
})
