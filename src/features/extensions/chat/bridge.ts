import type { ExtensionChatSession } from "./navigation"

interface ChatBridgeDependencies {
  check(): void
  session(): ExtensionChatSession | null
  send(id: string, text: string): Promise<void>
  setDraft?(id: string, text: string): Promise<void>
  prepare?(text: string): string
}

/** Bind once at invocation; never infer a new destination after awaiting the host. */
export function createExtensionChatBridge(dependencies: ChatBridgeDependencies): {
  sendMessage(text: string): Promise<void>
  setDraft(text: string): Promise<void>
} {
  async function perform(text: string, draft: boolean): Promise<void> {
    dependencies.check()
    const target = dependencies.session()
    if (!target) throw new Error("请先返回聊天，选择或创建一个会话，再操作扩展")
    const id = target.id
    const prompt = dependencies.prepare ? dependencies.prepare(text) : text
    if (draft) {
      if (!dependencies.setDraft) throw new Error("当前宿主不支持草稿写入")
      await dependencies.setDraft(id, prompt)
    } else await dependencies.send(id, prompt)
    dependencies.check()
  }
  return {
    sendMessage: text => perform(text, false),
    setDraft: text => perform(text, true)
  }
}
