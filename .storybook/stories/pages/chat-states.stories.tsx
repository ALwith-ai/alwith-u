import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, waitFor } from "storybook/test"

import { preparePreview } from "../../fixtures/prepare"
import { expandChatDetails } from "../expand-chat-details"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"

const meta = {
  id: "页面-聊天-对话状态",
  title: "页面/主窗聊天/对话状态",
  component: ProductPreview,
  loaders: [preparePreview],
  play: expandChatDetails,
  args: { page: "chat", chatCase: "conversation" },
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

const expandThinking: NonNullable<Story["play"]> = async (context) => {
  await expandChatDetails(context)
  const { canvasElement } = context
  const work = canvasElement.querySelector(".codex-work-trigger")
  const thinking = canvasElement.querySelector(".codex-reasoning-label")?.closest("button")
  await expect(work).toHaveAttribute("aria-expanded", "true")
  await expect(thinking).toHaveAttribute("aria-expanded", "true")
  await waitFor(() => {
    const details = canvasElement.querySelector<HTMLElement>(".codex-reasoning-details")
    expect(details).toHaveTextContent("正在比对最新组件与交付清单。")
    expect(details!.getBoundingClientRect().height).toBeGreaterThan(0)
  })
}

export const Conversation: Story = { name: "多内容回复 · 表格与代码", args: { chatCase: "conversation" } }

export const Running: Story = { name: "正在生成", args: { chatCase: "running" }, play: expandThinking }

export const Reasoning: Story = { name: "思考内容", args: { chatCase: "reasoning" }, play: expandThinking }

export const Tools: Story = {
  name: "工具执行中",
  args: { chatCase: "tools" },
  play: async (context) => {
    await expandChatDetails(context)
    await waitFor(() => expect(context.canvasElement.querySelector(".codex-patch-view")).toBeVisible())
    await expect(context.canvas.getByText("docs/交互说明.md", { exact: false })).toBeVisible()
  }
}

export const Plan: Story = {
  name: "任务计划",
  args: { chatCase: "plan" },
  play: async (context) => {
    await expandChatDetails(context)
    await expect(context.canvasElement.querySelectorAll(".codex-plan-entry")).toHaveLength(3)
    await waitFor(() => expect(context.canvas.getByText("汇总交付结果")).toBeVisible())
  }
}

export const Permission: Story = { name: "等待授权", args: { chatCase: "permission" } }

export const Question: Story = { name: "异步问题 · 选择与补充", args: { chatCase: "question" } }

export const Form: Story = { name: "表单请求", args: { chatCase: "form" } }

export const Url: Story = { name: "连接授权", args: { chatCase: "url" } }

export const Error: Story = { name: "模型错误 · 可重试", args: { chatCase: "error" } }

export const Stopped: Story = { name: "已停止 · 可重新连接", args: { chatCase: "stopped" } }

export const ReadOnly: Story = { name: "只读会话", args: { chatCase: "readOnly" } }

export const Restoring: Story = { name: "历史恢复中", args: { chatCase: "restoring" } }

export const History: Story = { name: "历史多轮内容", args: { chatCase: "history" } }

export const Long: Story = { name: "长会话 · 32轮", args: { chatCase: "long" } }

export const Files: Story = { name: "文件修改与差异", args: { chatCase: "files" } }

export const Image: Story = { name: "图片回复", args: { chatCase: "image" } }

export const Narrow: Story = { name: "窄窗口长内容", args: { width: 760, chatCase: "long" } }
