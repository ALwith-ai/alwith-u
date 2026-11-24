import type { ComponentProps } from "react"
import { expect, waitFor, within } from "storybook/test"

import { preparePreview } from "../../fixtures/prepare"
import preview from "../../preview"
import type { SharedMeta } from "../page-meta"
import { ProductPreview } from "../product-preview"
export const pageMeta = {
  loaders: [preparePreview],
  args: { page: "chat", chatCase: "conversation", voiceCase: "idle" },
  parameters: { layout: "fullscreen", productPage: true, a11y: { test: "todo" } }
} satisfies SharedMeta<ComponentProps<typeof ProductPreview>>

// pageMeta is shared with derived files, not a story.
const meta = preview.meta({
  title: "流程/主窗聊天/语音输入",
  excludeStories: ["pageMeta"],
  component: ProductPreview,
  ...pageMeta
})

export const Starting = meta.story({
  name: "连接麦克风中",
  args: { voiceCase: "starting" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "语音输入" }))
    await canvas.findByRole("button", { name: "正在连接麦克风…" })
  }
})
export const Recording = meta.story({
  name: "录音中 · 波形与取消",
  args: { voiceCase: "recording" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "语音输入" }))
    await canvas.findByRole("button", { name: "结束录音" })
  }
})
export const Transcribing = meta.story({
  name: "完成识别中",
  args: { voiceCase: "transcribing" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "语音输入" }))
    await userEvent.click(await canvas.findByRole("button", { name: "结束录音" }))
    await canvas.findByRole("button", { name: "正在完成识别…" })
  }
})
export const Error = meta.story({
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
})
export const NoSpeech = meta.story({
  name: "未识别到语音",
  args: { voiceCase: "noSpeech" },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "语音输入" }))
    await userEvent.click(await canvas.findByRole("button", { name: "结束录音" }))
    await within(canvasElement.ownerDocument.body).findByText("未识别到语音，已停止录音")
  }
})
