import { invoke } from "@tauri-apps/api/core"
import { emitTo, listen } from "@tauri-apps/api/event"
import { getCurrentWebviewWindow, WebviewWindow } from "@tauri-apps/api/webviewWindow"
import { createWindowController } from "./window-controller"
import type { ComposerDraft } from "@/features/chat/composer/drafts"

export type ChatTransfer = { sessionId: string | null; cwd: string | null; draft: ComposerDraft | null }
type SurfaceAction =
  | { type: "present"; transfer?: ChatTransfer }
  | { type: "release"; sessionId: string }
  | { type: "return"; transfer: ChatTransfer }
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
  let settle!: (value: SurfaceResponse) => void
  let fail!: (error: Error) => void
  const response = new Promise<SurfaceResponse>((resolve, reject) => {
    settle = resolve
    fail = reject
  })
  const stop = await listen<SurfaceResponse>(RESPONSE, ({ payload }) => {
    if (payload.id === id) settle(payload)
  })
  const timer = setTimeout(() => fail(new Error("Chat window did not respond")), 60_000)
  try {
    const from = getCurrentWebviewWindow().label
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
  return listen<SurfaceRequest>(REQUEST, async ({ payload }) => {
    if (!["main", "chat", "settings"].includes(payload.from)) return
    try {
      const value = await handler(payload.action)
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

async function createChatWindow(): Promise<void> {
  let ready!: () => void
  let fail!: (error: Error) => void
  const promise = new Promise<void>((resolve, reject) => {
    ready = resolve
    fail = reject
  })
  const stop = await listen(READY, ready)
  const timer = setTimeout(() => fail(new Error("Chat window failed to initialize")), 60_000)
  let stopError: (() => void) | undefined
  let created: WebviewWindow | undefined
  try {
    const window = new WebviewWindow("chat", {
      url: "/chat.html",
      title: "ALwith U",
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
export function presentChatWindow(): Promise<void> {
  return invoke("present_chat_window")
}

export async function releaseChatWindow(sessionId: string): Promise<ChatTransfer | null> {
  if (!(await WebviewWindow.getByLabel("chat"))) return null
  return requestChatSurface("chat", { type: "release", sessionId })
}
