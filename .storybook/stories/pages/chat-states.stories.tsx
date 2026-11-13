import type { Meta, StoryObj } from "@storybook/react-vite"
import { applyUpdate } from "@alwith/module-chat/client"
import { expect, waitFor } from "storybook/test"

import { preparePreview } from "../../fixtures/prepare"
import { makeSession } from "../../fixtures/catalog"
import { client } from "../../fixtures/client"
import { expandChatDetails } from "../expand-chat-details"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"

const meta = {
  id: "页面-聊天-对话状态",
  title: "页面/主窗聊天/对话流",
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
          "使用真实产品组件和独立的内存模拟数据。重新选择示例即可重置页面状态。"
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
  await waitFor(async () => {
    const details = canvasElement.querySelector<HTMLElement>(".codex-reasoning-details")
    await expect(details).toHaveTextContent("正在比对最新组件与交付清单。")
    await expect(details!.getBoundingClientRect().height).toBeGreaterThan(0)
  })
}

export const UserText: Story = { name: "用户消息 · 纯文本", parameters: { pageStateGroup: "01 内容类型/01 用户发送" }, args: { chatCase: "userText" } }

export const UserImage: Story = { name: "用户消息 · 图片附件", parameters: { pageStateGroup: "01 内容类型/01 用户发送" }, args: { chatCase: "userImage" } }

export const UserFile: Story = { name: "用户消息 · 文件引用", parameters: { pageStateGroup: "01 内容类型/01 用户发送" }, args: { chatCase: "userFile" } }

export const Text: Story = { name: "纯文本回复", parameters: { pageStateGroup: "01 内容类型/02 AI 回复" }, args: { chatCase: "plainText" } }

export const Markdown: Story = { name: "Markdown · 标题、列表与引用", parameters: { pageStateGroup: "01 内容类型/02 AI 回复" }, args: { chatCase: "markdown" } }

export const Table: Story = { name: "表格回复", parameters: { pageStateGroup: "01 内容类型/02 AI 回复" }, args: { chatCase: "table" } }

export const Code: Story = { name: "程序代码块 · TSX", parameters: { pageStateGroup: "01 内容类型/02 AI 回复" }, args: { chatCase: "code" } }

export const HtmlCode: Story = { name: "HTML 源码 · 以代码块显示", parameters: { pageStateGroup: "01 内容类型/02 AI 回复" }, args: { chatCase: "htmlCode" } }

export const Math: Story = { name: "数学公式 · 行内与独立公式", parameters: { pageStateGroup: "01 内容类型/02 AI 回复" }, args: { chatCase: "math" } }

export const Diagram: Story = { name: "Mermaid 图表", parameters: { pageStateGroup: "01 内容类型/02 AI 回复" }, args: { chatCase: "diagram" } }

export const Links: Story = { name: "网页链接与本地 MD 文件链接", parameters: { pageStateGroup: "01 内容类型/02 AI 回复" }, args: { chatCase: "links" } }

export const FileResource: Story = { name: "文件资源 · PDF 与 CSV", parameters: { pageStateGroup: "01 内容类型/02 AI 回复" }, args: { chatCase: "fileResource", binaryFiles: true } }

export const LinkedImage: Story = { name: "本地图片链接 · 预览与文件入口", parameters: { pageStateGroup: "01 内容类型/02 AI 回复" }, args: { chatCase: "linkedImage" } }

export const RasterImage: Story = { name: "PNG 图片 · 预览与放大", parameters: { pageStateGroup: "01 内容类型/02 AI 回复" }, args: { chatCase: "imagePreview" } }

export const Image: Story = { name: "SVG 图片资源 · 下载入口", parameters: { pageStateGroup: "01 内容类型/02 AI 回复" }, args: { chatCase: "image" } }

export const Conversation: Story = { name: "多内容回复 · 文本、表格与代码", parameters: { pageStateGroup: "01 内容类型/02 AI 回复" }, args: { chatCase: "conversation" } }

export const AwaitingResponse: Story = { name: "已发送 · 等待首次响应", parameters: { pageStateGroup: "02 执行状态/01 执行进程" }, args: { chatCase: "awaitingResponse" } }

export const ActivityThinking: Story = { name: "正在思考", parameters: { pageStateGroup: "02 执行状态/02 当前活动" }, args: { chatCase: "reasoning" }, play: async () => {} }

export const ActivitySearch: Story = { name: "正在搜索文件", parameters: { pageStateGroup: "02 执行状态/02 当前活动" }, args: { chatCase: "activitySearch" }, play: async () => {} }

export const ActivityWeb: Story = { name: "正在搜索网页", parameters: { pageStateGroup: "02 执行状态/02 当前活动" }, args: { chatCase: "activityWeb" }, play: async () => {} }

export const ActivityEdit: Story = { name: "正在编辑文件", parameters: { pageStateGroup: "02 执行状态/02 当前活动" }, args: { chatCase: "activityEdit" }, play: async () => {} }

export const ActivityRun: Story = { name: "正在运行命令", parameters: { pageStateGroup: "02 执行状态/02 当前活动" }, args: { chatCase: "activityRun" }, play: async () => {} }

export const ActivityDelete: Story = { name: "正在删除文件", parameters: { pageStateGroup: "02 执行状态/02 当前活动" }, args: { chatCase: "activityDelete" }, play: async () => {} }

export const ActivityMove: Story = { name: "正在移动文件", parameters: { pageStateGroup: "02 执行状态/02 当前活动" }, args: { chatCase: "activityMove" }, play: async () => {} }

export const CompletedActivities: Story = {
  name: "已执行活动汇总 · 继续思考",
  parameters: { pageStateGroup: "02 执行状态/03 已执行活动" },
  args: { chatCase: "completedActivities" },
  play: expandChatDetails
}

export const Plan: Story = {
  name: "任务计划 · 当前步骤与进度", parameters: { pageStateGroup: "02 执行状态/01 执行进程" },
  args: { chatCase: "plan" },
  play: async (context) => {
    await expandChatDetails(context)
    await expect(context.canvasElement.querySelectorAll(".codex-plan-entry")).toHaveLength(3)
    await waitFor(() => expect(context.canvas.getByText("汇总交付结果")).toBeVisible())
  }
}

export const Tools: Story = {
  name: "工具调用中 · 展开执行详情", parameters: { pageStateGroup: "02 执行状态/02 当前活动" },
  args: { chatCase: "tools" },
  play: async (context) => {
    await expandChatDetails(context)
    await waitFor(() => expect(context.canvasElement.querySelector(".codex-patch-view")).toBeVisible())
    await expect(context.canvas.getByText("docs/交付清单.md", { exact: false })).toBeVisible()
  }
}

export const Running: Story = {
  name: "正文生成中",
  parameters: { pageStateGroup: "02 执行状态/01 执行进程" },
  args: { chatCase: "streaming" },
  beforeEach: () => {
    const chunks = ["\n\n## 当前进度\n\n", "- 导航与侧栏", "检查完成。\n", "- 项目文件", "已核对。\n", "- 正在汇总", "文件预览", "和交付清单。"]
    let index = 0
    const timer = window.setInterval(() => {
      client.store.setState((state) => {
        const session = state.sessions.streaming
        if (session?.state !== "running" || state.runStates.streaming?.state !== "running") return state
        if (index === chunks.length) {
          index = 0
          return { sessions: { ...state.sessions, streaming: makeSession("streaming") } }
        }
        const next = applyUpdate(session, {
          sessionUpdate: "agent_message_chunk",
          messageId: "streaming-stream",
          content: { type: "text", text: chunks[index++]! }
        })
        return { sessions: { ...state.sessions, streaming: next } }
      })
    }, 700)
    return () => window.clearInterval(timer)
  },
  play: expandThinking
}

export const Steering: Story = { name: "执行中 · 用户补充指令", parameters: { pageStateGroup: "02 执行状态/01 执行进程" }, args: { chatCase: "steering" } }

export const Compacting: Story = { name: "上下文压缩中", parameters: { pageStateGroup: "02 执行状态/01 执行进程" }, args: { chatCase: "compacting" } }

export const Compacted: Story = { name: "上下文压缩完成 · 继续执行", parameters: { pageStateGroup: "02 执行状态/01 执行进程" }, args: { chatCase: "compacted" } }

export const Completed: Story = {
  name: "生成完成 · 回复已结束", parameters: { pageStateGroup: "02 执行状态/01 执行进程" }, args: { chatCase: "conversation" }
}

export const Permission: Story = { name: "等待操作授权", parameters: { pageStateGroup: "03 需要用户处理" }, args: { chatCase: "permission" } }

export const Question: Story = { name: "异步问题 · 选择与补充", parameters: { pageStateGroup: "03 需要用户处理" }, args: { chatCase: "question" } }

export const QuestionSubmitting: Story = {
  name: "异步问题 · 提交中",
  parameters: { pageStateGroup: "03 需要用户处理" },
  args: { chatCase: "questionSubmitting" },
  play: async ({ canvas, userEvent }) => {
    const prompt = client.prompt.bind(client)
    client.prompt = () => new Promise(() => {})
    try {
      const submit = canvas.getAllByRole("button", { name: "提交回答" })[0]
      await userEvent.click(submit)
      await waitFor(() => expect(submit).toBeDisabled())
    } finally {
      client.prompt = prompt
    }
  }
}

export const QuestionUnavailable: Story = { name: "异步问题 · 暂不可用", parameters: { pageStateGroup: "03 需要用户处理" }, args: { chatCase: "questionUnavailable" } }

export const QuestionAnswered: Story = { name: "异步问题 · 已回答", parameters: { pageStateGroup: "03 需要用户处理" }, args: { chatCase: "questionAnswered" } }

export const Form: Story = { name: "表单请求 · 补充信息", parameters: { pageStateGroup: "03 需要用户处理" }, args: { chatCase: "form" } }

export const FormQueue: Story = { name: "表单请求 · 队列中的第 1/3 项", parameters: { pageStateGroup: "03 需要用户处理" }, args: { chatCase: "formQueue" } }

export const Url: Story = { name: "连接授权 · 外部服务入口", parameters: { pageStateGroup: "03 需要用户处理" }, args: { chatCase: "url" } }

export const Cancelled: Story = { name: "停止生成 · 首次回复前", parameters: { pageStateGroup: "06 停止与异常" }, args: { chatCase: "cancelled" } }

export const CancelledPartial: Story = { name: "停止生成 · 保留部分回复", parameters: { pageStateGroup: "06 停止与异常" }, args: { chatCase: "cancelledPartial" } }

export const Error: Story = { name: "模型错误 · 可重试", parameters: { pageStateGroup: "06 停止与异常" }, args: { chatCase: "error" } }

export const ErrorRetrying: Story = { name: "模型错误 · 正在自动重试", parameters: { pageStateGroup: "06 停止与异常" }, args: { chatCase: "errorRetrying" } }

export const ErrorRetryFailed: Story = {
  name: "模型错误 · 重试失败",
  parameters: { pageStateGroup: "06 停止与异常" },
  args: { chatCase: "error" },
  play: async ({ canvas, userEvent }) => {
    const retry = client.retrySession.bind(client)
    client.retrySession = () => Promise.reject(new globalThis.Error("重试仍未成功，请检查网络后手动重试。"))
    try {
      await userEvent.click(await canvas.findByRole("button", { name: /秒后重试/ }))
      await waitFor(() => expect(canvas.getByText(/重试仍未成功/)).toBeVisible())
    } finally {
      client.retrySession = retry
    }
  }
}

export const ErrorNonRetryable: Story = { name: "模型错误 · 不可重试", parameters: { pageStateGroup: "06 停止与异常" }, args: { chatCase: "errorNonRetryable" } }

export const Stopped: Story = { name: "会话断开 · 可重新连接", parameters: { pageStateGroup: "06 停止与异常" }, args: { chatCase: "stopped" } }

export const DisconnectedMidTurn: Story = { name: "连接中断 · 本轮已停止", parameters: { pageStateGroup: "06 停止与异常" }, args: { chatCase: "disconnectedMidTurn" } }

export const CompactionFailed: Story = { name: "上下文压缩失败", parameters: { pageStateGroup: "06 停止与异常" }, args: { chatCase: "compactionFailed" } }

export const ToolFailed: Story = { name: "工具执行失败", parameters: { pageStateGroup: "06 停止与异常" }, args: { chatCase: "toolFailed" }, play: expandChatDetails }

export const ReadOnly: Story = { name: "只读会话", parameters: { pageStateGroup: "05 历史与访问" }, args: { chatCase: "readOnly" } }

export const Restoring: Story = {
  name: "历史恢复中", parameters: { pageStateGroup: "05 历史与访问" }, args: { chatCase: "restoring" },
  // History is intentionally unavailable; there are no content details to expand yet.
  play: async () => {}
}

export const History: Story = { name: "历史多轮内容", parameters: { pageStateGroup: "05 历史与访问" }, args: { chatCase: "history" } }

export const Long: Story = { name: "长会话 · 32轮", parameters: { pageStateGroup: "05 历史与访问" }, args: { chatCase: "long" } }

export const Files: Story = {
  name: "单文件修改 · 查看变更", parameters: { pageStateGroup: "04 文件变更" }, args: { chatCase: "files" },
  play: async (context) => {
    const work = await context.canvasElement.querySelector<HTMLButtonElement>(".codex-work-trigger")
    if (work?.getAttribute("aria-expanded") === "false") await context.userEvent.click(work)
    await expandChatDetails(context)
  }
}


const fileChangePlay: NonNullable<Story["play"]> = async (context) => {
  await expandChatDetails(context)
}
const undoFileChange: NonNullable<Story["play"]> = async (context) => {
  await fileChangePlay(context)
  const button = await context.canvas.findByRole("button", { name: "撤销修改" })
  await context.userEvent.click(button)
}
export const FilesMultiple: Story = { name: "多文件修改 · 查看变更", parameters: { pageStateGroup: "04 文件变更" }, args: { chatCase: "filesMultiple" }, play: fileChangePlay }
export const FilesUndone: Story = { name: "撤销成功 · 可重新应用", parameters: { pageStateGroup: "04 文件变更" }, args: { chatCase: "filesUndone" }, play: undoFileChange }
export const FilesReadOnly: Story = { name: "只读会话 · 不可撤销", parameters: { pageStateGroup: "04 文件变更" }, args: { chatCase: "filesReadOnly" }, play: fileChangePlay }
export const FilesFailed: Story = { name: "撤销失败 · 可重试", parameters: { pageStateGroup: "04 文件变更" }, args: { chatCase: "filesFailed" }, play: undoFileChange }
export const FilesPartial: Story = { name: "部分撤销 · 可重试或重新应用", parameters: { pageStateGroup: "04 文件变更" }, args: { chatCase: "filesPartial" }, play: undoFileChange }


export const ReplyActions: Story = {
  name: "回复操作 · 复制与创建分支", parameters: { pageStateGroup: "01 内容类型/03 消息操作" }, args: { chatCase: "messageActions" },
  play: async ({ canvas }) => { await canvas.findByRole("button", { name: "创建聊天分支" }) }
}

export const ReplyForkDisconnected: Story = {
  name: "连接断开 · 暂不可创建分支", parameters: { pageStateGroup: "01 内容类型/03 消息操作" }, args: { chatCase: "messageActions", connection: "disconnected" },
  play: async ({ canvas }) => { await canvas.findByRole("button", { name: "创建聊天分支" }) }
}
export const ReplyForkPending: Story = {
  name: "创建分支 · 进行中", parameters: { pageStateGroup: "01 内容类型/03 消息操作" }, args: { chatCase: "messageForkPending" },
  play: async ({ canvas, userEvent }) => { await userEvent.click(await canvas.findByRole("button", { name: "创建聊天分支" })); await canvas.findByText("正在创建分支会话…") }
}
export const ReplyForkOrigin: Story = {
  name: "分支聊天 · 返回原聊天", parameters: { pageStateGroup: "01 内容类型/03 消息操作" }, args: { chatCase: "messageForkOrigin" },
  play: async ({ canvas }) => { await canvas.findByRole("button", { name: "从原聊天继续" }) }
}
export const ReplyForkError: Story = {
  name: "创建分支 · 失败", parameters: { pageStateGroup: "01 内容类型/03 消息操作" }, args: { chatCase: "messageForkError" },
  play: async ({ canvas, userEvent }) => { await userEvent.click(await canvas.findByRole("button", { name: "创建聊天分支" })) }
}

export const ReplyForkReadOnly: Story = {
  name: "只读会话 · 创建聊天分叉", parameters: { pageStateGroup: "01 内容类型/03 消息操作" }, args: { chatCase: "messageForkReadOnly" },
  play: async ({ canvas }) => { await canvas.findByRole("button", { name: "创建聊天分叉" }) }
}
export const ReplyForkSourceMissing: Story = {
  name: "返回原聊天 · 原会话不可用", parameters: { pageStateGroup: "01 内容类型/03 消息操作" }, args: { chatCase: "messageForkSourceMissing" },
  play: async ({ canvas, userEvent }) => { await userEvent.click(await canvas.findByRole("button", { name: "从原聊天继续" })) }
}
