import { emitTo } from "@tauri-apps/api/event"
import { getCurrentWebviewWindow, WebviewWindow } from "@tauri-apps/api/webviewWindow"
import { commands } from "@/bindings"
import type { ComposerDraft } from "@/features/chat/composer/drafts"
import { type ChatWindowSurface, useChatWindowSurface } from "./chat-window-state"
import { client } from "./client"
import i18n from "./i18n"
import { createWindowController } from "./window-controller"

export type ChatTransfer = { sessionId: string | null; cwd: string | null; draft: ComposerDraft | null }
type SurfaceAction =
  | { type: "present"; transfer?: ChatTransfer; sessionId?: string }
  | ({ type: "surface" } & ChatWindowSurface)
  | { type: "inspectSurface" }
  | { type: "release"; sessionId: string }
  | { type: "markRead"; sessionId: string }
  | { type: "shortcut"; shortcut: string }
type SurfaceRequest = { id: string; from: "main" | "chat" | "settings"; action: SurfaceAction }
type SurfaceResponse = { id: string; value: ChatTransfer | null; error: string | null }
const REQUEST = "chat:surface-request"
const RESPONSE = "chat:surface-response"
const READY = "chat:surface-ready"
let hostReady: Promise<unknown> | null = null
export function setChatWindowHostReady(ready: Promise<unknown>): void {
  hostReady = ready
}

export async function requestChatSurface(target: "main" | "chat", action: SurfaceAction): Promise<ChatTransfer | null> {
  const id = crypto.randomUUID()
  const current = getCurrentWebviewWindow()
  let settle!: (value: SurfaceResponse) => void
  let fail!: (error: Error) => void
  const response = new Promise<SurfaceResponse>((resolve, reject) => {
    settle = resolve
    fail = reject
  })
  const stop = await current.listen<SurfaceResponse>(RESPONSE, ({ payload }) => {
    if (payload.id === id) settle(payload)
  })
  const timer = setTimeout(() => fail(new Error("Chat window did not respond")), 60_000)
  try {
    const from = current.label
    if (from !== "main" && from !== "chat" && from !== "settings") throw new Error("Invalid chat window sender")
    await emitTo(target, REQUEST, { id, from, action } satisfies SurfaceRequest)
    const result = await response
    if (result.error !== null) throw new Error(result.error)
    return result.value
  } finally {
    clearTimeout(timer)
    stop()
  }
}

export async function serveChatSurface(
  handler: (action: SurfaceAction) => Promise<ChatTransfer | null>
): Promise<() => void> {
  const window = getCurrentWebviewWindow()
  return window.listen<SurfaceRequest>(REQUEST, async ({ payload }) => {
    if (!["main", "chat", "settings"].includes(payload.from)) return
    try {
      let value: ChatTransfer | null = null
      const action = payload.action
      if (action.type === "surface") {
        if (window.label !== "main" || payload.from !== "chat") throw new Error("Invalid chat surface sender")
        if ((action.sessionId !== null && typeof action.sessionId !== "string") || typeof action.visible !== "boolean")
          throw new Error("Invalid chat surface state")
        useChatWindowSurface.setState({ sessionId: action.sessionId, visible: action.visible })
      } else if (action.type === "inspectSurface") {
        if (window.label !== "chat" || payload.from !== "main") throw new Error("Invalid chat surface inspection")
        const visible = (await window.isVisible()) && !(await window.isMinimized())
        await publishChatWindowSurface(useChatWindowSurface.getState().sessionId, visible)
      } else value = await handler(action)
      await emitTo(payload.from, RESPONSE, { id: payload.id, value, error: null } satisfies SurfaceResponse)
    } catch (error) {
      await emitTo(payload.from, RESPONSE, {
        id: payload.id,
        value: null,
        error: error instanceof Error ? error.message : String(error)
      } satisfies SurfaceResponse)
    }
  })
}

function forgetChatWindow(): void {
  useChatWindowSurface.setState({ sessionId: null, visible: false })
  client.store.setState(state => ({
    sessionWindows: Object.fromEntries(Object.entries(state.sessionWindows).filter(([, owner]) => owner !== "chat"))
  }))
}

async function createChatWindow(): Promise<void> {
  let ready!: () => void
  let fail!: (error: Error) => void
  const promise = new Promise<void>((resolve, reject) => {
    ready = resolve
    fail = reject
  })
  const stop = await getCurrentWebviewWindow().listen(READY, ready)
  const timer = setTimeout(() => fail(new Error("Chat window failed to initialize")), 60_000)
  let stopError: (() => void) | undefined
  let created: WebviewWindow | undefined
  try {
    const window = new WebviewWindow("chat", {
      url: "/chat.html",
      title: i18n.t("app.name"),
      width: 560,
      height: 640,
      minWidth: 420,
      minHeight: 360,
      center: true,
      decorations: false,
      transparent: true,
      alwaysOnTop: true,
      visible: false,
      focus: false,
      maximizable: false,
      skipTaskbar: true
    })
    created = window
    await window.once("tauri://destroyed", forgetChatWindow)
    stopError = await window.once("tauri://error", ({ payload }) => fail(new Error(String(payload))))
    await promise
  } catch (error) {
    // No transfer has been sent yet; discard a failed bootstrap so an explicit retry can create it.
    if (created && (await WebviewWindow.getByLabel("chat"))) await created.destroy()
    throw error
  } finally {
    clearTimeout(timer)
    stop()
    stopError?.()
  }
}

const controller = createWindowController<ChatTransfer>({
  exists: async () => (await WebviewWindow.getByLabel("chat")) !== null,
  create: createChatWindow,
  deliver: async transfer => {
    await requestChatSurface("chat", { type: "present", transfer })
  },
  present: async () => {
    await requestChatSurface("chat", { type: "present" })
  }
})

/** Only main opens windows, so concurrent shortcuts and buttons share the same queue. */
export async function openChatWindow(transfer?: ChatTransfer): Promise<void> {
  if (hostReady === null) throw new Error("Chat window host has not initialized")
  await hostReady
  await controller.open(transfer)
}
export function announceChatReady(): Promise<void> {
  return emitTo("main", READY)
}
export async function presentChatWindow(): Promise<void> {
  await commands.presentChatWindow()
}

export async function releaseChatWindow(sessionId: string): Promise<ChatTransfer | null> {
  if (!(await WebviewWindow.getByLabel("chat"))) return null
  return requestChatSurface("chat", { type: "release", sessionId })
}

/** Report actual binding even when hidden; visibility only controls foreground grouping. */
export async function publishChatWindowSurface(sessionId: string | null, visible: boolean): Promise<void> {
  useChatWindowSurface.setState({ sessionId, visible })
  await requestChatSurface("main", { type: "surface", sessionId, visible })
}

/** Rehydrate the projection when the main webview remounts around an existing chat window. */
export async function syncChatWindowSurface(): Promise<void> {
  const chat = await WebviewWindow.getByLabel("chat")
  if (chat === null) forgetChatWindow()
  else await requestChatSurface("chat", { type: "inspectSurface" })
}

export async function focusChatSession(sessionId: string): Promise<void> {
  await requestChatSurface("chat", { type: "present", sessionId })
}
