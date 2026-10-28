import type { ChatWindowSurface } from "@/lib/chat-window-state"

/** The same foreground/background partition used by ActivityPanel, preserving order in each group. */
export function displayedActivityIds(
  ids: readonly string[],
  main: ChatWindowSurface,
  chat: ChatWindowSurface
): string[] {
  const foreground = (id: string): boolean =>
    (main.visible && main.sessionId === id) || (chat.visible && chat.sessionId === id)
  return [...ids.filter(foreground), ...ids.filter((id) => !foreground(id))]
}
