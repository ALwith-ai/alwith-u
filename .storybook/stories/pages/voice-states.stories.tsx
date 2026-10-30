import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, waitFor, within } from "storybook/test"

import { preparePreview } from "../../fixtures/prepare"
import { ProductPreview } from "../product-preview"
const meta = {
  id: "页面-聊天-语音输入",
  title: "页面/主窗聊天/语音输入",
  component: ProductPreview,
  loaders: [preparePreview],
  args: { page: "chat", chatCase: "conversation", voiceCase: "idle" },
  parameters: { layout: "fullscreen", productPage: true, a11y: { test: "todo" } }
} satisfies Meta<typeof ProductPreview>
export default meta
type Story = StoryObj<typeof meta>
export const Idle: Story = { name: "语音已启用 · 待录音" }
export const Starting: Story = {
  name: "连接麦克风中",
  args: { voiceCase: "starting" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "语音输入" }))
    await canvas.findByRole("button", { name: "正在连接麦克风…" })
  }
}
export const Recording: Story = {
  name: "录音中 · 波形与取消",
  args: { voiceCase: "recording" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "语音输入" }))
    await canvas.findByRole("button", { name: "结束录音" })
  }
}
export const Transcribing: Story = {
  name: "完成识别中",
  args: { voiceCase: "transcribing" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "语音输入" }))
    await userEvent.click(await canvas.findByRole("button", { name: "结束录音" }))
    await canvas.findByRole("button", { name: "正在完成识别…" })
  }
}
export const Error: Story = {
  name: "语音识别失败",
  args: { voiceCase: "error" },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "语音输入" }))
    await userEvent.click(await canvas.findByRole("button", { name: "结束录音" }))
    await waitFor(async () =>
      expect(
        await within(canvasElement.ownerDocument.body).findByText("模拟语音识别服务连接失败，请重试。")
      ).toBeVisible()
    )
  }
}
export const NoSpeech: Story = {
  name: "未识别到语音",
  args: { voiceCase: "noSpeech" },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "语音输入" }))
    await userEvent.click(await canvas.findByRole("button", { name: "结束录音" }))
    await within(canvasElement.ownerDocument.body).findByText("未识别到语音，已停止录音")
  }
}
export const Unconfigured: Story = { name: "语音未配置 · 跳转设置", args: { voiceCase: "unconfigured" } }
