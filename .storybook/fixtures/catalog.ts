import type * as acp from "@agentclientprotocol/sdk/experimental/v2/unstable"
import { acknowledgePrompt, addPrompt, applyUpdate, createSession, type Session } from "@alwith/api"

import type { PendingAction, ThreadSummary } from "../../src/agent/client"

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
  "running",
  "reasoning",
  "tools",
  "plan",
  "permission",
  "question",
  "form",
  "url",
  "error",
  "stopped",
  "readOnly",
  "restoring",
  "history",
  "long",
  "files",
  "image"
] as const
export type ChatCase = (typeof chatCases)[number]

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
  session = userMessage(session, "请检查产品工作台的页面和交互，整理本周的交付内容，并把结果保存到项目中。")
  if (kind === "running" || kind === "reasoning") {
    session = applyUpdate(session, {
      sessionUpdate: "agent_thought_chunk",
      messageId: `${id}-thought`,
      content: {
        type: "text",
        text: "先核对导航、项目文件和现有页面，再逐一检查空状态、加载状态与异常分支。\n\n正在比对最新组件与交付清单。"
      }
    })
    return { ...session, state: "running" }
  }
  if (kind === "tools" || kind === "files") {
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
    session = applyUpdate(session, {
      sessionUpdate: "tool_call_update",
      toolCallId: `${id}-edit`,
      name: "apply_patch",
      title: "更新交付清单",
      kind: "edit",
      status: kind === "tools" ? "in_progress" : "completed",
      locations: [{ path: `${PROJECT_DIRECTORY}/docs/交付清单.md`, line: 1 }],
      content: [
        {
          type: "diff",
          changes: [{ operation: "modify", path: `${PROJECT_DIRECTORY}/docs/交付清单.md` }],
          patch: {
            format: "git_patch",
            text: "--- a/docs/交付清单.md\n+++ b/docs/交付清单.md\n@@ -1,2 +1,4 @@\n # 交付清单\n-- 页面梳理\n+- 页面梳理：已完成\n+- 交互验证：已完成\n+- 文件预览：待复核\n"
          }
        }
      ]
    })
    if (kind === "tools") return { ...session, state: "running" }
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
  if (kind === "permission" || kind === "form" || kind === "url")
    return { ...assistantMessage(session, "已完成检查，继续执行前需要你补充确认。"), state: "running" }
  if (kind === "question") {
    return {
      ...applyUpdate(session, {
        sessionUpdate: "agent_message",
        messageId: `${id}-question-${++questionSequence}`,
        content: [{ type: "text", text: "交付资料需要覆盖哪些使用场景？" }],
        _meta: {
          codex: {
            turnId: `turn:${id}-user`,
            phase: "final_answer",
            delivery: "async",
            questions: [
              { title: "交付范围", options: ["全部页面与流程", "仅核心聊天流程", "仅本周新增内容"] },
              { title: "补充说明", options: null }
            ]
          }
        }
      }),
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
  session = assistantMessage(
    session,
    "已整理好本周的交付资料。\n\n## 检查结果\n\n| 模块 | 状态 | 说明 |\n| --- | --- | --- |\n| 聊天与项目 | 已完成 | 包含新建、切换和归档 |\n| 文件工作区 | 已完成 | 支持编辑、预览与多标签 |\n| 插件与设置 | 已完成 | 包含正常、空列表和异常情况 |\n\n你可以打开 [交付清单](docs/交付清单.md) 查看明细。\n\n```tsx\nexport function Dashboard() {\n  return <main>产品工作台</main>\n}\n```\n\n下一步建议先复核文件预览，再确认最终交付范围。"
  )
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

export function makeThreads(): ThreadSummary[] {
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
