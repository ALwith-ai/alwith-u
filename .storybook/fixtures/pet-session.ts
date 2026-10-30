import type { PetObservation, PetSessionHost, PetWindowHost } from "@alwith/module-auth/pets/core"

import { PROJECT_DIRECTORY } from "./catalog"
import { resetChatWindow } from "./chat-window"
import { navigatePreview } from "./native"

export type BubbleCase = "idle" | "running" | "permission" | "question" | "error" | "readOnly" | "unavailable"
let current: PetObservation | null = null
const listeners = new Set<(value: PetObservation | null) => void>()
let completion: ReturnType<typeof setTimeout> | undefined
function publish(value: PetObservation | null) {
  current = value
  for (const listener of listeners) listener(value)
}
export function resetPetSession(kind: BubbleCase = "idle") {
  clearTimeout(completion)
  publish(
    kind === "unavailable"
      ? null
      : {
          binding: {
            connectionEpoch: "demo-epoch",
            agentId: "storybook",
            sessionId: "conversation",
            incarnation: "demo",
            bindingRevision: 1
          },
          source: "snapshot",
          revision: 1,
          state:
            kind === "running" ? "running" : kind === "permission" || kind === "question" ? "requires_action" : "idle",
          since: Date.now(),
          title: "整理本周交付",
          cwd: PROJECT_DIRECTORY,
          windowLabel: "main",
          candidates: [
            { sessionId: "conversation", title: "整理本周交付", cwd: PROJECT_DIRECTORY, windowLabel: "main" }
          ],
          owner: "storybook",
          executionId: null,
          executionRole: null,
          access: kind === "readOnly" ? "readOnly" : "writable",
          surfaceVisible: false,
          error: kind === "error" ? "模拟连接中断，请打开聊天窗口重试。" : null,
          reply: null,
          userMessage:
            kind === "running" ? { messageId: "pet-user", text: "请继续检查项目文件。", timestamp: Date.now() } : null,
          prompt:
            kind === "permission" || kind === "question"
              ? {
                  kind,
                  token: "pet-request",
                  title: kind === "permission" ? "允许更新项目文件？" : "需要覆盖哪些交付内容？",
                  detail: "产品工作台 / docs/交付清单.md",
                  options:
                    kind === "permission"
                      ? [
                          { id: "allow_once", label: "允许" },
                          { id: "reject_once", label: "拒绝" }
                        ]
                      : [
                          { id: "all", label: "全部页面与流程" },
                          { id: "core", label: "核心聊天流程" }
                        ]
                }
              : null
        }
  )
}
export const petSessions: PetSessionHost = {
  snapshot: () => current,
  subscribe: (listener) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  send: async (_binding, _requestId, text) => {
    if (!current) throw new Error("Pet conversation unavailable")
    publish({
      ...current,
      source: "event",
      state: "running",
      since: Date.now(),
      userMessage: { messageId: "pet-user", text, timestamp: Date.now() }
    })
    completion = setTimeout(() => {
      if (current)
        publish({
          ...current,
          state: "done",
          since: Date.now(),
          reply: { messageId: "pet-answer", text: "已更新交付清单，可以继续打开项目查看。" }
        })
    }, 450)
  },
  answer: async () => {
    if (current)
      publish({
        ...current,
        state: "done",
        prompt: null,
        reply: { messageId: "pet-confirmed", text: "已收到确认，继续处理项目任务。" }
      })
  },
  openChat: async () => {
    resetChatWindow(current?.binding.sessionId ?? null, current?.cwd ?? PROJECT_DIRECTORY)
    navigatePreview("floating")
  },
  activate: async () => {
    navigatePreview("chat")
  },
  select: async () => {}
}
export const petWindows: PetWindowHost = {
  call: async <T>(action: string): Promise<T> => {
    let value: unknown
    if (action === "monitors")
      value = [{ position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 }, scaleFactor: 1 }]
    else if (action === "position") value = { x: 300, y: 300 }
    else if (action === "size") value = { width: 200, height: 200 }
    else if (action === "scale") value = 1
    else if (action === "session-menu") value = null
    return value as T
  },
  openPet: async () => "shown",
  closePet: async () => {},
  openRecharge: async () => {},
  geometry: async () => () => {},
  moved: async () => () => {},
  commands: () => () => {}
}
