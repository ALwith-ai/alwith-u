import { requestVibemonView } from "@alwith/module-auth/pets/core"
import { importDraft } from "@alwith/module-chat/conversation"

import type { ChatTransfer } from "../../src/lib/chat-window"
import type { Preferences } from "../../src/lib/preferences"
import { PROJECT_DIRECTORY } from "./catalog"
import { client } from "./client"
import { navigatePreview } from "./native"

export type { ChatTransfer } from "../../src/lib/chat-window"
type Action = { type: string; transfer?: ChatTransfer; sessionId?: string; view?: "pull" | "equip" }
let handler: ((action: Action) => Promise<ChatTransfer | null>) | null = null
let initial: ChatTransfer = { sessionId: null, cwd: PROJECT_DIRECTORY, draft: null }
export function resetChatWindow(
  sessionId: string | null,
  cwd: string | null,
  draft: ChatTransfer["draft"] = null
): void {
  initial = { sessionId, cwd, draft }
  handler = null
}
export const previewPreferences: Preferences = {
  sidebarPinned: true,
  lastProjectDirectory: PROJECT_DIRECTORY,
  language: "zh-CN",
  zoomLevel: null,
  modelSelections: { main: null, chat: null },
  navigationSoundMode: "none",
  navigationInstrument: "acoustic_grand_piano",
  externalEditor: null
}
export async function serveChatSurface(callback: NonNullable<typeof handler>) {
  handler = callback
  return () => {
    handler = null
  }
}
export async function announceChatReady() {
  await handler?.({ type: "present", transfer: initial })
}
export async function requestChatSurface(target: string, action: Action): Promise<ChatTransfer | null> {
  if (target === "chat") return (await handler?.(action)) ?? null
  if (action.type === "vibemon" && action.view) {
    requestVibemonView(action.view)
    navigatePreview("vibemon")
  }
  if (action.type === "present") {
    if (action.transfer) {
      if (action.transfer.sessionId) await client.transferDraft(action.transfer.sessionId, "main")
      importDraft(action.transfer.sessionId ?? "draft", action.transfer.draft)
      window.dispatchEvent(new CustomEvent("storybook:transfer", { detail: action.transfer }))
    }
    navigatePreview("chat")
  }
  return null
}
export async function presentChatWindow() {}
export async function publishChatWindowSurface() {}
export async function openChatWindow() {
  navigatePreview("floating")
}
export async function releaseChatWindow() {
  return initial
}
export async function syncChatWindowSurface() {}
export async function focusChatSession(sessionId: string) {
  await handler?.({ type: "present", sessionId })
}
export function setChatWindowHostReady() {}
