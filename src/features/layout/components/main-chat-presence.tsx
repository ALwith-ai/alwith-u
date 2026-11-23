import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { useEffect } from "react"
import { toast } from "sonner"

import { updateMainVibemonSurface } from "@/features/vibemon/main-host"
import { useMainWindowSurface } from "@/lib/chat-window-state"
import { useReadVisibleSession } from "@/lib/use-read-visible-session"

import { useCanvasPaneVisible } from "../use-canvas-pane-visible"

export function MainChatPresence({
  sessionId,
  chatView,
  focused
}: {
  sessionId: string | null
  chatView: boolean
  focused: boolean
}) {
  const onPage = useCanvasPaneVisible("chat")
  const showing = chatView && onPage
  useReadVisibleSession(sessionId, focused && showing)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const window = getCurrentWebviewWindow()
      const visible = showing && (focused || (await window.isVisible())) && !(await window.isMinimized())
      if (cancelled) return
      useMainWindowSurface.setState({ sessionId, visible })
      await updateMainVibemonSurface(sessionId, visible)
    })().catch((error: unknown) => toast.error(error instanceof Error ? error.message : String(error)))
    return () => {
      cancelled = true
    }
  }, [sessionId, focused, showing])
  return null
}
