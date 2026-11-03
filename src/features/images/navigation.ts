import { isTauri } from "@tauri-apps/api/core"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { create } from "zustand"

import { requestChatSurface } from "@/lib/chat-window"

export const imageNavigation = create<{ request: { sessionId: string; revision: number } | null }>(() => ({
  request: null
}))
export async function openImagesForSession(sessionId: string): Promise<void> {
  if (isTauri() && getCurrentWebviewWindow().label !== "main") {
    await requestChatSurface("main", { type: "images", sessionId })
    return
  }
  imageNavigation.setState((state) => ({ request: { sessionId, revision: (state.request?.revision ?? 0) + 1 } }))
}
