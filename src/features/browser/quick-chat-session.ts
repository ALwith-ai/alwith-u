import { invoke } from "@tauri-apps/api/core"

import { client } from "@/lib/client"

import { useBrowserQuickChat } from "./quick-chat-state"

/** Serializes creation, restoration and replacement without borrowing either window's draft slot. */
let pending: Promise<void> | null = null
export function prepareBrowserChat(replace = false): Promise<void> {
  if (pending) return pending
  pending = (async () => {
    await client.connect()
    const previous = useBrowserQuickChat.getState()
    if (replace && previous.sessionId !== null) {
      await client.stopSession(previous.sessionId)
      await invoke("cef_browser_quick_chat", { sessionId: null })
      useBrowserQuickChat.setState({ sessionId: null, cwd: null })
    }
    const current = useBrowserQuickChat.getState()
    if (current.sessionId !== null) {
      if (current.cwd === null) throw Error("Browser conversation has no directory")
      await client.open(current.sessionId, current.cwd, {})
    } else {
      const { chatDirectory } = await client.refreshProjectContext(true)
      // The object overload creates an independent session, without changing main/chat draft slots.
      const id = await client.newSession(chatDirectory, {
        meta: { alwith: { inputMode: "chat" } }
      })
      useBrowserQuickChat.setState({
        sessionId: id,
        cwd: client.session(id).cwd
      })
    }
    await invoke("cef_browser_quick_chat", {
      sessionId: useBrowserQuickChat.getState().sessionId
    })
  })().finally(() => {
    pending = null
  })
  return pending
}
