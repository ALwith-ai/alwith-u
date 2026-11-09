import { requestVibemonView } from "@alwith/module-auth/vibemon/core"
import { importDraft } from "@alwith/module-chat/conversation"

import type { ChatTransfer } from "../../src/lib/chat-window"
import type { Preferences } from "../../src/lib/preferences"
import { PROJECT_DIRECTORY } from "./catalog"
import { client, restoreConnection } from "./client"
import { navigatePreview } from "./native"

export type { ChatTransfer } from "../../src/lib/chat-window"
type Action = { type: string; transfer?: ChatTransfer; sessionId?: string; view?: "pull" | "equip" }
let handler: ((action: Action) => Promise<ChatTransfer | null>) | null = null
let previewConnection: "ready" | "connecting" | "disconnected" | "failed" | undefined
let initial: ChatTransfer = { sessionId: null, cwd: PROJECT_DIRECTORY, draft: null }
export function resetChatWindow(
  sessionId: string | null,
  cwd: string | null,
  draft: ChatTransfer["draft"] = null,
  connection?: typeof previewConnection
): void {
  initial = { sessionId, cwd, draft }
  previewConnection = connection
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
export function serveChatSurface(callback: NonNullable<typeof handler>) {
  handler = callback
  return Promise.resolve(() => {
    handler = null
  })
}
export async function announceChatReady() {
  const previous = initial.sessionId ? client.state.sessions[initial.sessionId] : null
  // Present successfully first, then reproduce a connection lost while the window is open.
  if (previewConnection === "disconnected" || previewConnection === "failed") restoreConnection()
  await handler?.({ type: "present", transfer: initial })
  // Hydration represents reopening the retained window, not resuming a stopped process.
  if (previous && (!previous.attached || previous.restoring)) {
    client.store.setState((state) => ({
      sessions: { ...state.sessions, [previous.id]: { ...state.sessions[previous.id]!, attached: previous.attached, restoring: previous.restoring } }
    }))
  }
  if (previewConnection === "disconnected" || previewConnection === "failed")
    client.store.setState({ connection: previewConnection })
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
export function openChatWindow() {
  navigatePreview("floating")
  return Promise.resolve()
}
export function releaseChatWindow() {
  return Promise.resolve(initial)
}
export async function syncChatWindowSurface() {}
export async function focusChatSession(sessionId: string) {
  await handler?.({ type: "present", sessionId })
}
export function setChatWindowHostReady() {}
