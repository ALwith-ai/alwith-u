import { create } from "zustand"

import { quickChatDefault, type QuickChatEdge, type QuickChatSide, type Size } from "./quick-chat-geometry"

const key = "browser.quickChat.v1"
const storage = typeof window === "undefined" ? undefined : window.localStorage
interface QuickChatState {
  sessionId: string | null
  cwd: string | null
  expanded: boolean
  side: QuickChatSide
  edge: QuickChatEdge
  size: Size
  visible: boolean
  revealSessionId: string | null
}
function restore(): QuickChatState {
  const initial: QuickChatState = {
    sessionId: null,
    cwd: null,
    expanded: false,
    side: "right",
    edge: "bottom",
    size: quickChatDefault,
    visible: false,
    revealSessionId: null
  }
  const saved = storage?.getItem(key)
  if (!saved) return initial
  try {
    const value = JSON.parse(saved) as Partial<QuickChatState>
    if (
      !["left", "right"].includes(value.side ?? "") ||
      !Number.isFinite(value.size?.width) ||
      !Number.isFinite(value.size?.height) ||
      value.size!.width <= 0 ||
      value.size!.height <= 0
    )
      return initial
    return {
      sessionId: null,
      cwd: null,
      expanded: false,
      side: value.side!,
      edge: value.edge === "top" ? "top" : "bottom",
      size: value.size!,
      visible: false,
      revealSessionId: null
    }
  } catch {
    return initial
  }
}
/** Presentation only; conversation data remains in Codex. Main's selection never writes this store. */
export const useBrowserQuickChat = create<QuickChatState>(() => restore())
useBrowserQuickChat.subscribe(({ side, edge, size }) => storage?.setItem(key, JSON.stringify({ side, edge, size })))
