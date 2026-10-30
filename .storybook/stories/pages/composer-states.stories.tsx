import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, waitFor, within } from "storybook/test"

import { actionsTaken, client } from "../../fixtures/client"
import { preparePreview } from "../../fixtures/prepare"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"

const meta = {
  id: "页面-聊天-输入与附件状态",
  title: "页面/主窗聊天/输入与附件状态",
  component: ProductPreview,
  loaders: [preparePreview],
  args: { page: "chat", chatCase: "conversation" },
  argTypes: productPreviewArgTypes,
  parameters: { layout: "fullscreen", productPage: true, a11y: { test: "todo" } }
} satisfies Meta<typeof ProductPreview>
export default meta
type Story = StoryObj<typeof meta>
export const PermissionMenu: Story = {
  name: "权限模式菜单",
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: /^切换权限模式/ }))
    await within(canvasElement.ownerDocument.body).findByText("完全访问")
  }
}
export const PermissionChange: Story = {
  name: "权限模式 · 切换并应用",
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: /^切换权限模式/ }))
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await body.findByRole("menuitemradio", { name: /完全访问/ }))
    await waitFor(() =>
      expect(
        client.session("conversation").configOptions.find((option) => option.category === "mode")?.currentValue
      ).toBe("agent-full-access")
    )
  }
}
export const ImageAdded: Story = {
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
}
export const ImageRemove: Story = {
  ...ImageAdded,
  name: "图片附件 · 添加后移除",
  play: async (context) => {
    await ImageAdded.play!(context)
    within(context.canvasElement).getByRole<HTMLButtonElement>("button", { name: "移除附件" }).focus()
    await context.userEvent.keyboard("{Enter}")
    await expect(within(context.canvasElement).queryByRole("button", { name: "移除附件" })).toBeNull()
  }
}
export const ImageSend: Story = {
  ...ImageAdded,
  name: "图片附件 · 发送",
  play: async (context) => {
    await ImageAdded.play!(context)
    await context.userEvent.click(within(context.canvasElement).getByRole("button", { name: "发送" }))
    await waitFor(() =>
      expect(
        actionsTaken.some(
          (action) => action.type === "prompt" && JSON.stringify(action.value).includes('"type":"image"')
        )
      ).toBe(true)
    )
  }
}
export const ImageLimit: Story = {
  name: "图片总大小超限",
  play: async ({ canvasElement, userEvent }) => {
    await userEvent.upload(
      canvasElement.querySelector<HTMLInputElement>('input[type="file"]')!,
      new File([new Uint8Array(21 * 1024 * 1024)], "large.png", { type: "image/png" })
    )
    await within(canvasElement.ownerDocument.body).findByText("图片附件过大")
  }
}
export const UnsupportedAttachment: Story = {
  name: "不支持的附件格式",
  play: async ({ canvasElement, userEvent }) => {
    const input = canvasElement.querySelector<HTMLInputElement>('input[type="file"]')!
    input.removeAttribute("accept")
    await userEvent.upload(input, new File(["demo"], "demo.pdf", { type: "application/pdf" }))
    await within(canvasElement.ownerDocument.body).findByText("只支持图片附件")
  }
}
export const Mention: Story = {
  name: "文件引用 · 搜索并选择",
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.type(await canvas.findByRole("textbox", { name: "发送消息" }), "@README")
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await body.findByRole("option", { name: /README.md/ }))
    await canvas.findByRole("button", { name: /移除.*README/ })
  }
}
export const MentionSend: Story = {
  ...Mention,
  name: "文件引用 · 发送上下文",
  play: async (context) => {
    await Mention.play!(context)
    await context.userEvent.click(within(context.canvasElement).getByRole("button", { name: "发送" }))
    await waitFor(() =>
      expect(
        actionsTaken.some(
          (action) => action.type === "prompt" && JSON.stringify(action.value).includes('"type":"resource_link"')
        )
      ).toBe(true)
    )
  }
}
export const MentionEmpty: Story = {
  name: "文件引用 · 无匹配",
  args: { composerCase: "mentionEmpty" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(await canvas.findByRole("textbox", { name: "发送消息" }), "@missing")
    await canvas.findByText("没有匹配的文件")
  }
}
export const MentionError: Story = {
  name: "文件引用 · 搜索失败",
  args: { composerCase: "mentionError" },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.type(await canvas.findByRole("textbox", { name: "发送消息" }), "@README")
    await within(canvasElement.ownerDocument.body).findAllByText("模拟文件搜索失败")
  }
}
export const LongText: Story = {
  name: "长文本转为附件",
  play: async ({ canvas, userEvent }) => {
    const input = await canvas.findByRole("textbox", { name: "发送消息" })
    await userEvent.click(input)
    await userEvent.paste("Delivery checklist. ".repeat(300))
    await canvas.findByText("6000 个字符")
  }
}
export const LongTextPending: Story = {
  ...LongText,
  name: "长文本附件 · 写入中",
  args: { composerCase: "textPending" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("textbox", { name: "发送消息" }))
    await userEvent.paste("Delivery checklist. ".repeat(300))
    await canvas.findByText("正在添加粘贴的文本…")
  }
}
export const LongTextError: Story = {
  ...LongTextPending,
  name: "长文本附件 · 写入失败",
  args: { composerCase: "textError" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("textbox", { name: "发送消息" }))
    await userEvent.paste("Delivery checklist. ".repeat(300))
    await canvas.findByText("文件创建失败")
  }
}
export const LongTextRetry: Story = {
  ...LongTextError,
  name: "长文本附件 · 失败后重试",
  play: async (context) => {
    await LongTextError.play!(context)
    await context.userEvent.click(within(context.canvasElement).getByRole("button", { name: "重试创建文本附件" }))
    await within(context.canvasElement).findByText("6000 个字符")
  }
}
export const Prediction: Story = {
  name: "输入预测 · 待接受",
  args: { composerCase: "prediction" },
  play: async ({ canvas }) => {
    await canvas.findByPlaceholderText("请继续核对文件预览")
  }
}
export const PredictionAccept: Story = {
  ...Prediction,
  name: "输入预测 · Tab 接受并编辑",
  play: async ({ canvas, userEvent }) => {
    const input = await canvas.findByPlaceholderText("请继续核对文件预览")
    await userEvent.click(input)
    await userEvent.keyboard("{Tab}")
    await expect(input).toHaveValue("请继续核对文件预览")
    await expect(actionsTaken.filter((action) => action.type === "prompt")).toHaveLength(0)
  }
}
export const PredictionError: Story = {
  name: "输入预测 · 服务失败",
  args: { composerCase: "predictionError" },
  play: async ({ canvas, userEvent }) => {
    await waitFor(() => expect(actionsTaken.some((action) => action.type === "prediction")).toBe(true))
    const input = canvas.getByRole("textbox", { name: "发送消息" })
    await userEvent.type(input, "继续检查交付内容")
    await expect(input).toHaveValue("继续检查交付内容")
  }
}
