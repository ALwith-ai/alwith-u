import chatImage from "./chat-image.json"
import type * as acp from "@agentclientprotocol/sdk/experimental/v2/unstable"
import { asyncQuestionId, questionReplyEnvelope } from "@alwith/module-chat/async-question-card"
import { acknowledgePrompt, addPrompt, applyUpdate, createSession, type Session } from "@alwith/module-chat/client"

import type { PendingAction, SessionSummary } from "../../src/agent/client"

export const QUICK_DIRECTORY = "/Users/demo/Documents/ALwith U"
export const PROJECT_DIRECTORY = "/Users/demo/Projects/产品工作台"
export const OTHER_DIRECTORY = "/Users/demo/Projects/品牌网站"
export const FIXED_TIME = "2026-10-23T04:00:00Z"

export const configOptions: acp.SessionConfigOption[] = [
  {
    configId: "model",
    name: "模型",
    category: "model",
    type: "select",
    currentValue: "gpt-6.1-sol",
    options: [
      {
        groupId: "chatgpt",
        name: "ChatGPT",
        options: [
          { value: "gpt-6.1-sol", name: "GPT-6.1-Sol" },
          { value: "gpt-6-astra", name: "GPT-6-Astra" },
          { value: "gpt-6-luna", name: "GPT-6-Luna" }
        ]
      },
      { groupId: "deepseek", name: "DeepSeek", options: [{ value: "gateway:deepseek:deepseek", name: "DeepSeek" }] }
    ]
  },
  {
    configId: "reasoning_effort",
    name: "推理强度",
    category: "thought_level",
    type: "select",
    currentValue: "medium",
    options: [
      { value: "low", name: "低" },
      { value: "medium", name: "中" },
      { value: "high", name: "高" }
    ]
  },
  {
    configId: "mode",
    name: "权限",
    category: "mode",
    type: "select",
    currentValue: "agent",
    options: [
      { value: "read-only", name: "只读" },
      { value: "agent", name: "按需批准" },
      { value: "agent-full-access", name: "完全访问" }
    ]
  }
]

export function userMessage(session: Session, text: string, id = `${session.id}-user`): Session {
  const content = [{ type: "text" as const, text }]
  return applyUpdate(acknowledgePrompt(addPrompt(session, content, `local:${id}`), `local:${id}`, id), {
    sessionUpdate: "user_message",
    messageId: id,
    content,
    _meta: { codex: { turnId: `turn:${id}` } }
  })
}

export function assistantMessage(session: Session, text: string, id = `${session.id}-answer`): Session {
  return applyUpdate(session, {
    sessionUpdate: "agent_message",
    messageId: id,
    content: [{ type: "text", text }],
    _meta: { codex: { phase: "final_answer" } }
  })
}

export const chatCases = [
  "welcome",
  "project",
  "conversation",
  "plainText",
  "markdown",
  "table",
  "code",
  "htmlCode",
  "links",
  "diagram",
  "math",
  "linkedImage",
  "fileResource",
  "userText",
  "userImage",
  "userFile",
  "running",
  "awaitingResponse",
  "compacting",
  "compacted",
  "steering",
  "cancelled",
  "cancelledPartial",
  "streaming",
  "reasoning",
  "activityEdit",
  "activityRun",
  "activitySearch",
  "activityWeb",
  "activityDelete",
  "activityMove",
  "completedActivities",
  "tools",
  "plan",
  "permission",
  "question",
  "questionSubmitting",
  "questionUnavailable",
  "questionAnswered",
  "form",
  "formQueue",
  "url",
  "error",
  "errorNonRetryable",
  "errorRetrying",
  "disconnectedMidTurn",
  "compactionFailed",
  "toolFailed",
  "stopped",
  "readOnly",
  "restoring",
  "history",
  "long",
  "files",
  "filesMultiple",
  "filesUndone",
  "filesReadOnly",
  "filesFailed",
  "filesPartial",
  "messageActions",
  "messageForkPending",
  "messageForkError",
  "messageForkOrigin",
  "messageForkReadOnly",
  "messageForkSourceMissing",
  "image",
  "imagePreview"
] as const
export type ChatCase = (typeof chatCases)[number]

let fileSequence = 0
let questionSequence = 0
export function makeSession(kind: ChatCase, id: string = kind): Session {
  let session: Session = {
    ...createSession(id, kind === "welcome" ? QUICK_DIRECTORY : PROJECT_DIRECTORY),
    attached: true,
    configOptions,
    title: "整理产品工作台的交互和交付资料"
  }
  if (kind === "welcome" || kind === "project") return { ...session, title: null }
  if (kind === "restoring") return { ...session, restoring: true, items: [] }
  if (kind === "cancelled") return {
    ...addPrompt(session, [{ type: "text", text: "请检查项目文件。" }], `local:${id}-user`),
    state: "idle",
    lastStopReason: "cancelled"
  }
  if (kind === "cancelledPartial") return {
    ...applyUpdate(userMessage(session, "请检查产品工作台的页面和交互。"), {
      sessionUpdate: "agent_message_chunk",
      messageId: `${id}-partial`,
      content: { type: "text", text: "我已经检查完项目结构，接下来会核对交付清单和文件预览……" },
      _meta: { codex: { turnId: `turn:${id}-user`, phase: "commentary" } }
    }),
    state: "idle",
    lastStopReason: "cancelled"
  }
  if (kind === "userText" || kind === "userImage" || kind === "userFile") {
    const content: acp.ContentBlock[] = kind === "userImage"
      ? [{ type: "text", text: "请查看这张图片。" }, { type: "image", mimeType: chatImage.mimeType, data: chatImage.data }]
      : kind === "userFile"
        ? [{ type: "resource_link", uri: encodeURI(`file://${PROJECT_DIRECTORY}/README.md`), name: "README.md" }, { type: "text", text: "请查看这个文件。" }]
        : [{ type: "text", text: "请整理本周的交付进度。" }]
    const promptId = `local:${id}-user`
    session = acknowledgePrompt(addPrompt(session, content, promptId), promptId, `${id}-user`)
    return {
      ...assistantMessage(applyUpdate(session, {
        sessionUpdate: "user_message",
        messageId: `${id}-user`,
        content,
        _meta: { codex: { turnId: `turn:${id}-user` } }
      }), "已收到。"),
      lastStopReason: "end_turn"
    }
  }
  session = userMessage(session, "请检查产品工作台的页面和交互，整理本周的交付内容，并把结果保存到项目中。")
  if (["messageActions", "messageForkPending", "messageForkError", "messageForkOrigin", "messageForkReadOnly", "messageForkSourceMissing"].includes(kind)) {
    session = applyUpdate(session, {
      sessionUpdate: "agent_message", messageId: `${id}-answer`,
      content: [{ type: "text", text: "已整理本周的交付进度，可以继续检查项目文件。" }],
      _meta: { codex: { turnId: `turn:${id}-user`, phase: "final_answer" } }
    })
    return { ...session, lastStopReason: "end_turn", readOnly: kind === "messageForkReadOnly" }
  }
  if (kind === "completedActivities") {
    const activities: { kind: acp.ToolKind; name: string; title: string; rawInput?: Record<string, string> }[] = [
      { kind: "read", name: "read_file", title: "读取项目文件" },
      { kind: "search", name: "search_files", title: "搜索文件" },
      { kind: "fetch", name: "web_search", title: "搜索网页" },
      { kind: "edit", name: "apply_patch", title: "编辑文件" },
      { kind: "execute", name: "exec_command", title: "bun run storybook:check", rawInput: { command: "bun run storybook:check" } },
      { kind: "delete", name: "delete_file", title: "删除文件" },
      { kind: "move", name: "move_file", title: "移动文件" }
    ]
    for (const [index, activity] of activities.entries()) {
      session = applyUpdate(session, {
        sessionUpdate: "tool_call_update", toolCallId: `${id}-tool-${index}`,
        ...activity, status: "completed"
      })
    }
    session = applyUpdate(session, {
      sessionUpdate: "agent_thought_chunk", messageId: `${id}-thought`,
      content: { type: "text", text: "正在整理已完成的检查结果。" }
    })
    return { ...session, state: "running" }
  }
  const activityKinds: Partial<Record<ChatCase, { kind: acp.ToolKind; name: string; title: string }>> = {
    activityEdit: { kind: "edit", name: "apply_patch", title: "编辑文件" },
    activityRun: { kind: "execute", name: "exec_command", title: "bun run storybook:check" },
    activitySearch: { kind: "search", name: "search_files", title: "搜索文件" },
    activityWeb: { kind: "fetch", name: "web_search", title: "搜索网页" },
    activityDelete: { kind: "delete", name: "delete_file", title: "删除文件" },
    activityMove: { kind: "move", name: "move_file", title: "移动文件" }
  }
  const activity = activityKinds[kind]
  if (activity) return {
    ...applyUpdate(session, {
      sessionUpdate: "tool_call_update", toolCallId: `${id}-tool`,
      ...activity, status: "in_progress",
      ...(kind === "activityRun" ? { rawInput: { command: "bun run storybook:check" } } : {})
    }),
    state: "running"
  }
  if (kind === "awaitingResponse") return { ...session, state: "running" }
  if (kind === "compacting" || kind === "compacted") {
    const compacting = applyUpdate(session, { sessionUpdate: "compaction_update", compactionId: `${id}-compact`, status: "in_progress" })
    return {
      ...(kind === "compacted" ? applyUpdate(compacting, { sessionUpdate: "compaction_update", compactionId: `${id}-compact`, status: "completed" }) : compacting),
      state: "running"
    }
  }
  if (kind === "compactionFailed")
    return {
      ...applyUpdate(session, {
        sessionUpdate: "compaction_update",
        compactionId: `${id}-compact`,
        status: "failed",
        error: "上下文超出模型限制，无法压缩。请新建会话后继续。"
      }),
      state: "idle"
    }
  if (kind === "toolFailed")
    return {
      ...applyUpdate(session, {
        sessionUpdate: "tool_call_update",
        toolCallId: `${id}-run`,
        name: "exec_command",
        title: "运行测试",
        kind: "execute",
        status: "failed",
        rawInput: { command: "bun run test" },
        rawOutput: "1 test failed\n\nExpected: 200\nReceived: 500\n\nexit code 1"
      }),
      state: "idle"
    }
  if (kind === "steering") {
    session = applyUpdate(session, {
      sessionUpdate: "agent_message_chunk", messageId: `${id}-stream`,
      content: { type: "text", text: "正在检查项目文件和页面。" },
      _meta: { codex: { turnId: `turn:${id}-user`, phase: "commentary" } }
    })
    return { ...addPrompt(session, [{ type: "text", text: "请同时检查移动端布局。" }], `local:${id}-steer`), state: "running" }
  }
  if (kind === "imagePreview") return {
    ...applyUpdate(assistantMessage(session, "下面是 PNG 图片示例。"), {
      sessionUpdate: "agent_message", messageId: `${id}-image`,
      content: [{ type: "image", mimeType: chatImage.mimeType, data: chatImage.data }],
      _meta: { codex: { phase: "final_answer" } }
    }), lastStopReason: "end_turn"
  }
  const contentSamples: Partial<Record<ChatCase, string>> = {
    plainText: "已核对项目中的导航和文件目录。聊天记录保存在当前会话中，后续可以继续补充问题。",
    markdown: "# 项目检查结果\n\n本次检查包含 **导航**、*文件预览* 和 `README.md`。\n\n## 已完成\n\n- 核对项目目录\n- 检查交互入口\n\n## 后续步骤\n\n1. 打开交付清单\n2. 确认待处理内容\n\n> 这是一条 Markdown 引用说明。",
    table: "以下是模块检查结果：\n\n| 模块 | 状态 | 下一步 |\n| --- | --- | --- |\n| 导航 | 已核对 | 确认入口名称 |\n| 文件预览 | 待确认 | 打开文件检查 |\n| 设置 | 已核对 | 整理说明 |",
    code: "下面是组件代码：\n\n```tsx\nexport function Summary({ count }: { count: number }) {\n  return <section aria-label=\"结果\">已处理 {count} 项</section>\n}\n```",
    htmlCode: "下面是 HTML 源码，在聊天中显示为代码块：\n\n```html\n<!doctype html>\n<html lang=\"zh-CN\">\n  <head><title>项目报告</title></head>\n  <body><main><h1>检查结果</h1><p>报告已整理。</p></main></body>\n</html>\n```",
    links: "## 相关链接\n\n- [网页报告（HTML 链接）](https://example.test/report.html)\n- [交付清单（本地 Markdown 文件）](docs/交付清单.md)\n\n网页地址与本地文件链接复用真实产品的链接处理逻辑。",
    diagram: "以下是交付流程：\n\n```mermaid\nflowchart LR\n  A[整理需求] --> B[检查页面]\n  B --> C[交付结果]\n```",
    math: String.raw`行内公式：$E=mc^2$。` + "\n\n" + String.raw`$$\sum_{i=1}^{n} i = \frac{n(n+1)}{2}$$`,
    linkedImage: "项目中的图片：\n\n![品牌示例图](assets/brand.svg)",
    fileResource: "已生成交付资料：\n\n[示例 PDF](samples/sample.pdf)\n\n[任务清单 CSV](data/tasks.csv)"
  }
  const contentSample = contentSamples[kind]
  if (contentSample !== undefined) return { ...assistantMessage(session, contentSample), lastStopReason: "end_turn" }
  if (kind === "running" || kind === "streaming" || kind === "reasoning") {
    session = applyUpdate(session, {
      sessionUpdate: "agent_thought_chunk",
      messageId: `${id}-thought`,
      content: {
        type: "text",
        text: "先核对导航、项目文件和现有页面，再逐一检查空状态、加载状态与异常分支。\n\n正在比对最新组件与交付清单。"
      }
    })
    if (kind === "running" || kind === "streaming") session = applyUpdate(session, {
      sessionUpdate: "agent_message_chunk", messageId: `${id}-stream`,
      content: { type: "text", text: kind === "streaming" ? "正在整理交付结果：" : "已核对导航入口和项目目录，正在整理交付结果。\n\n## 当前进度\n\n- 导航与侧栏检查完成\n- 正在汇总文件预览的检查记录" }
    })
    return { ...session, state: "running" }
  }
  if (kind === "tools" || kind.startsWith("files")) {
    session = applyUpdate(session, {
      sessionUpdate: "tool_call_update",
      toolCallId: `${id}-read`,
      name: "read_file",
      title: "读取项目文件",
      kind: "read",
      status: "completed",
      locations: [{ path: `${PROJECT_DIRECTORY}/README.md`, line: 1 }],
      content: [
        {
          type: "content",
          content: { type: "text", text: "README.md\ndocs/交互说明.md\nsrc/dashboard.tsx\nassets/brand.svg" }
        }
      ]
    })
    const fileId = kind.startsWith("files") ? `${id}-edit-${++fileSequence}` : `${id}-edit`
    session = applyUpdate(session, {
      sessionUpdate: "tool_call_update",
      toolCallId: fileId,
      name: "apply_patch",
      title: "更新交付清单",
      kind: "edit",
      status: kind === "tools" ? "in_progress" : "completed",
      locations: [{ path: `${PROJECT_DIRECTORY}/docs/checklist.md`, line: 1 }],
      content: [
        {
          type: "diff",
          changes: [{ operation: "modify", path: `${PROJECT_DIRECTORY}/docs/checklist.md` }],
          patch: {
            format: "git_patch",
            text: "--- a/docs/checklist.md\n+++ b/docs/checklist.md\n@@ -1,2 +1,2 @@\n # 交付清单\n-- 页面梳理：待完成\n+- 页面梳理：已完成\n"
          }
        }
      ]
    })
    if (kind === "tools") return { ...session, state: "running" }
    if (["filesMultiple", "filesPartial"].includes(kind)) {
      session = applyUpdate(session, {
        sessionUpdate: "tool_call_update", toolCallId: `${fileId}-second`, name: "apply_patch",
        title: "更新交互说明", kind: "edit", status: "completed",
        locations: [{ path: `${PROJECT_DIRECTORY}/docs/interaction.md`, line: 1 }],
        content: [{ type: "diff", changes: [{ operation: "modify", path: `${PROJECT_DIRECTORY}/docs/interaction.md` }],
          patch: { format: "git_patch", text: "--- a/docs/interaction.md\n+++ b/docs/interaction.md\n@@ -1 +1 @@\n-交互检查：待完成\n+交互检查：已完成\n" } }]
      })
    }

  }
  if (kind === "plan") {
    session = applyUpdate(session, {
      sessionUpdate: "plan_update",
      plan: {
        type: "items",
        planId: `${id}-plan`,
        entries: [
          { content: "梳理页面与状态", priority: "high", status: "completed" },
          { content: "检查文件工作区和预览", priority: "high", status: "in_progress" },
          { content: "汇总交付结果", priority: "medium", status: "pending" }
        ]
      }
    })
    return { ...assistantMessage(session, "页面清单已经整理好，正在检查文件预览与交互。"), state: "running" }
  }
  if (kind === "permission" || kind === "form" || kind === "formQueue" || kind === "url")
    return { ...assistantMessage(session, "已完成检查，继续执行前需要你补充确认。"), state: "running" }
  if (kind === "question" || kind === "questionSubmitting" || kind === "questionUnavailable" || kind === "questionAnswered") {
    const questionMessageId = `${id}-question-${++questionSequence}`
    const questions = [
      { title: "交付范围", options: ["全部页面与流程", "仅核心聊天流程", "仅本周新增内容"] },
      { title: "补充说明", options: null }
    ]
    session = applyUpdate(session, {
      sessionUpdate: "agent_message",
      messageId: questionMessageId,
      content: [{ type: "text", text: "交付资料需要覆盖哪些使用场景？" }],
      _meta: {
        codex: {
          turnId: `turn:${id}-user`,
          phase: "final_answer",
          delivery: "async",
          questions
        }
      }
    })
    if (kind === "questionAnswered") {
      const reply = {
        questionItemId: asyncQuestionId(questionMessageId, 0),
        question: questions[0].title,
        answer: "全部页面与流程"
      }
      const replyContent = {
        type: "text" as const,
        text: questionReplyEnvelope(reply),
        _meta: { codex: { questionReply: reply } }
      }
      const replyId = `${id}-question-reply`
      session = acknowledgePrompt(addPrompt(session, [replyContent], `local:${replyId}`), `local:${replyId}`, replyId)
      session = applyUpdate(session, {
        sessionUpdate: "user_message",
        messageId: replyId,
        content: [replyContent],
        _meta: { codex: { turnId: `turn:${id}-user`, questionReply: reply } }
      })
    }
    return {
      ...session,
      ...(kind === "questionUnavailable" ? { attached: false } : {}),
      state: "running"
    }
  }
  if (kind === "error") {
    return applyUpdate(session, {
      sessionUpdate: "agent_message",
      messageId: `codex-error:${id}`,
      content: [{ type: "text", text: "模型当前繁忙，请稍后重试或切换模型。" }],
      _meta: {
        codex: {
          turnId: `turn:${id}-user`,
          error: { message: "模型当前繁忙，请稍后重试或切换模型。", category: "overloaded", retryable: true }
        }
      }
    })
  }
  if (kind === "errorNonRetryable") {
    return applyUpdate(session, {
      sessionUpdate: "agent_message",
      messageId: `codex-error:${id}`,
      content: [{ type: "text", text: "模型拒绝了这次请求，请调整输入后重试。" }],
      _meta: {
        codex: {
          turnId: `turn:${id}-user`,
          error: { message: "模型拒绝了这次请求，请调整输入后重试。", category: "refusal", retryable: false }
        }
      }
    })
  }
  if (kind === "errorRetrying") {
    return {
      ...applyUpdate(session, {
        sessionUpdate: "agent_message",
        messageId: `codex-error:${id}`,
        content: [{ type: "text", text: "模型当前繁忙，正在自动重试。" }],
        _meta: {
          codex: {
            turnId: `turn:${id}-user`,
            error: { message: "模型当前繁忙，正在自动重试。", category: "overloaded", retryable: true }
          }
        }
      }),
      state: "running",
      lastStopReason: "error",
      _meta: { codex: { retry: { message: "Reconnecting... 2/5", codexErrorInfo: "serverOverloaded" } } }
    }
  }
  if (kind === "disconnectedMidTurn") {
    return {
      ...applyUpdate(session, {
        sessionUpdate: "agent_message_chunk",
        messageId: `${id}-partial`,
        content: { type: "text", text: "我已经完成前半部分检查，正在继续核对交付清单……" },
        _meta: { codex: { turnId: `turn:${id}-user`, phase: "commentary" } }
      }),
      attached: false,
      state: "idle",
      error: {
        stopReason: "disconnected",
        error: null,
        meta: { codex: { error: { message: "连接中断，本轮生成已停止。", retryable: false } } }
      }
    }
  }
  if (kind.startsWith("files")) {
    session = assistantMessage(session, "已更新交付资料。")
    return { ...session, lastStopReason: "end_turn", readOnly: kind === "filesReadOnly" }
  }
  session = assistantMessage(
    session,
    "已整理好本周的交付资料。\n\n## 检查结果\n\n| 模块 | 状态 | 说明 |\n| --- | --- | --- |\n| 聊天与项目 | 已完成 | 包含新建、切换和归档 |\n| 文件工作区 | 已完成 | 支持编辑、预览与多标签 |\n| 插件与设置 | 已完成 | 包含正常、空列表和异常情况 |\n\n你可以打开 [交付清单](docs/交付清单.md) 查看明细。\n\n```tsx\nexport function Dashboard() {\n  return <main>产品工作台</main>\n}\n```\n\n下一步建议先复核文件预览，再确认最终交付范围。"
  )
  session = { ...session, lastStopReason: "end_turn" }
  if (kind === "readOnly") return { ...session, readOnly: true }
  if (kind === "stopped") return { ...session, attached: false }
  if (kind === "long" || kind === "history") {
    for (let index = 1; index <= (kind === "long" ? 32 : 8); index++) {
      session = assistantMessage(
        userMessage(session, `第 ${index} 轮：请继续检查模块 ${index} 的细节。`, `${id}-user-${index}`),
        `模块 ${index} 已完成检查。\n\n已核对正常内容、长文本、空状态和异常处理。\n\n- 导航与操作一致\n- 项目文件可以继续编辑\n- 交付资料已更新`,
        `${id}-answer-${index}`
      )
    }
  }
  // The long fixture is a live conversation; indexed native history has its own case.
  if (kind === "long")
    session = {
      ...session,
      items: session.items.map((item) => (item.kind === "user" ? { ...item, _meta: null } : item))
    }
  if (kind === "image")
    session = applyUpdate(session, {
      sessionUpdate: "agent_message",
      messageId: `${id}-image`,
      content: [
        {
          type: "image",
          mimeType: "image/svg+xml",
          data: btoa(
            '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#eef2f5"/><text x="64" y="180" font-size="32" fill="#344054">ALwith U · Product workspace</text></svg>'
          )
        }
      ],
      _meta: { codex: { phase: "final_answer" } }
    })
  return session
}

export function pendingAction(kind: "permission" | "form" | "url", sessionId: string): PendingAction {
  if (kind === "permission")
    return {
      id: `${sessionId}-approval`,
      kind: "permission",
      sessionId,
      params: {
        sessionId,
        title: "允许更新项目文件？",
        subject: {
          type: "tool_call",
          toolCall: {
            toolCallId: "write-delivery",
            title: "保存交付清单",
            kind: "edit",
            status: "pending",
            content: [{ type: "content", content: { type: "text", text: "将检查结果写入 docs/交付清单.md。" } }]
          }
        },
        options: [
          { optionId: "allow_once", name: "允许本次操作", kind: "allow_once" },
          { optionId: "allow_always", name: "始终允许", kind: "allow_always" },
          { optionId: "reject_once", name: "拒绝", kind: "reject_once" }
        ]
      }
    }
  if (kind === "url")
    return {
      id: `${sessionId}-url`,
      kind: "elicitation",
      sessionId,
      params: {
        sessionId,
        mode: "url",
        message: "请连接文档服务后继续。",
        url: "https://example.test/connect",
        elicitationId: "demo-connection"
      }
    }
  return {
    id: `${sessionId}-form`,
    kind: "elicitation",
    sessionId,
    params: {
      sessionId,
      mode: "form",
      message: "补充交付信息",
      requestedSchema: {
        type: "object",
        properties: {
          owner: { type: "string", title: "负责人", default: "林然" },
          scope: { type: "string", title: "交付范围", enum: ["全部页面", "核心流程", "新增内容"] },
          confirmed: { type: "boolean", title: "同时包含验证记录", default: true }
        },
        required: ["owner", "scope"]
      }
    }
  }
}

export function makeThreads(): SessionSummary[] {
  return Array.from({ length: 28 }, (_, index) => ({
    sessionId: index === 0 ? "conversation" : index === 1 ? "running" : index === 2 ? "permission" : `thread-${index}`,
    cwd: index % 4 === 0 ? QUICK_DIRECTORY : index % 4 === 3 ? OTHER_DIRECTORY : PROJECT_DIRECTORY,
    title: [
      "整理产品工作台的交互和交付资料",
      "检查页面与加载状态",
      "更新交付清单，需要确认",
      "品牌网站首页改版",
      "整理周会纪要与行动项",
      "修复文件预览与编辑状态",
      "梳理插件接入说明"
    ][index % 7],
    updatedAt: new Date(Date.parse(FIXED_TIME) - index * 3_600_000).toISOString(),
    archived: false
  }))
}
