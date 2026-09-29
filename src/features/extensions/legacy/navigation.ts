import type { LegacySession } from "./bridge"

interface LegacyNavigation {
  currentSession(): LegacySession | null
  openView(id: string): void
  send(sessionId: string, text: string): Promise<void>
}

let navigation: LegacyNavigation | undefined

export function connectLegacyNavigation(value: LegacyNavigation): () => void {
  navigation = value
  return (): void => {
    if (navigation === value) navigation = undefined
  }
}

export function legacyNavigation(): LegacyNavigation {
  if (!navigation) throw new Error("请在主窗口打开扩展以使用会话和页面功能")
  return navigation
}
