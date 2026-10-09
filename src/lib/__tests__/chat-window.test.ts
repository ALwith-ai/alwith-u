import type * as eventApi from "@tauri-apps/api/event"
import type * as windowApi from "@tauri-apps/api/webviewWindow"
import type { Event, EventCallback, EventName } from "@tauri-apps/api/event"
import { expect, test, vi } from "vitest"

type Handler = (event: Event<unknown>) => void | Promise<void>

const globalListeners = new Map<string, Set<Handler>>()
const windowListeners = new Map<string, Map<string, Set<Handler>>>()
let currentLabel = "main"

function addListener(store: Map<string, Set<Handler>>, event: EventName, handler: Handler): () => void {
  const bucket = store.get(event) ?? new Set()
  bucket.add(handler)
  store.set(event, bucket)
  return () => bucket.delete(handler)
}

async function dispatch(listeners: Iterable<Handler>, event: string, payload: unknown): Promise<void> {
  await Promise.all([...listeners].map(handler => handler({ event, id: 0, payload })))
}

const listen = async <T>(event: EventName, handler: EventCallback<T>): Promise<() => void> =>
  addListener(globalListeners, event, handler as Handler)

const emitTo: typeof eventApi.emitTo = async (target, event, payload): Promise<void> => {
  if (typeof target !== "string") throw new Error("Expected a window label")
  await dispatch(globalListeners.get(event) ?? [], event, payload)
  await dispatch(windowListeners.get(target)?.get(event) ?? [], event, payload)
}

vi.mock("@tauri-apps/api/event", () => ({ emitTo, listen }))
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => {
    const label = currentLabel
    return {
      label,
      listen: async <T>(event: EventName, handler: EventCallback<T>) => {
        const listeners = windowListeners.get(label) ?? new Map<string, Set<Handler>>()
        windowListeners.set(label, listeners)
        return addListener(listeners, event, handler as Handler)
      }
    } as windowApi.WebviewWindow
  }
}))

const { requestChatSurface, serveChatSurface } = await import("../chat-window")

test("a chat-targeted release is handled only by the chat window", async () => {
  const mainActions: string[] = []
  const chatActions: string[] = []

  currentLabel = "main"
  const stopMain = await serveChatSurface(async action => {
    mainActions.push(action.type)
    throw new Error("Unsupported main window action")
  })
  currentLabel = "chat"
  const stopChat = await serveChatSurface(async action => {
    chatActions.push(action.type)
    await Promise.resolve()
    return null
  })

  try {
    currentLabel = "main"
    await expect(requestChatSurface("chat", { type: "release", sessionId: "session-1" })).resolves.toBeNull()
    expect(mainActions).toEqual([])
    expect(chatActions).toEqual(["release"])
  } finally {
    stopMain()
    stopChat()
  }
})
