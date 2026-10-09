export interface ExtensionChatSession {
  id: string
  cwd: string
  title: string
}

interface ExtensionNavigation {
  currentSession(): ExtensionChatSession | null
  openView(id: string): void
  setDraft(sessionId: string, text: string, requiredSkills: string[], check?: () => void): Promise<void>
  send(sessionId: string, text: string, requiredSkills: string[], check?: () => void): Promise<void>
}

let navigation: ExtensionNavigation | undefined

export function connectExtensionNavigation(value: ExtensionNavigation): () => void {
  navigation = value
  return (): void => {
    if (navigation === value) navigation = undefined
  }
}

export function extensionNavigation(): ExtensionNavigation {
  if (!navigation) throw new Error("请在主窗口打开扩展以使用会话和页面功能")
  return navigation
}
