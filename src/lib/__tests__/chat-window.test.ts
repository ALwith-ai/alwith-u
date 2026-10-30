import type * as eventApi from "@tauri-apps/api/event"
import type { Event, EventCallback, EventName } from "@tauri-apps/api/event"
import type * as windowApi from "@tauri-apps/api/webviewWindow"
import { afterEach, expect, test, vi } from "vitest"

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
  for (const handler of listeners) await handler({ event, id: 0, payload })
}

const listen = <T>(event: EventName, handler: EventCallback<T>): Promise<() => void> =>
  Promise.try(() => addListener(globalListeners, event, handler as Handler))

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
      listen: <T>(event: EventName, handler: EventCallback<T>) => {
        return Promise.try(() => {
          const listeners = windowListeners.get(label) ?? new Map<string, Set<Handler>>()
          windowListeners.set(label, listeners)
          return addListener(listeners, event, handler as Handler)
        })
      }
    } as windowApi.WebviewWindow
  }
}))

const { useChatWindowSurface, useMainWindowSurface } = await import("../chat-window-state")
const { requestChatSurface, serveChatSurface } = await import("../chat-window")
const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow")

afterEach(() => {
  useChatWindowSurface.setState({ sessionId: null, visible: false }, true)
  useMainWindowSurface.setState({ sessionId: null, visible: false }, true)
})

test("main surface snapshots reach a newly reporting chat window and follow selection and visibility", async () => {
  currentLabel = "main"
  useMainWindowSurface.setState({ sessionId: "main-before-chat", visible: true })
  const stopMain = await serveChatSurface(() => {
    return Promise.reject(new Error("Surface synchronization must not navigate"))
  })
  currentLabel = "chat"
  const reports: unknown[] = []
  const stopReports = await getCurrentWebviewWindow().listen("chat:main-surface", ({ payload }) =>
    reports.push(payload)
  )
  try {
    await requestChatSurface("main", { type: "surface", sessionId: "floating", visible: true })
    expect(reports).toEqual([{ sessionId: "main-before-chat", visible: true }])
    useMainWindowSurface.setState({ sessionId: "main-after-switch", visible: true })
    await Promise.resolve()
    useMainWindowSurface.setState({ visible: false })
    await Promise.resolve()
    expect(reports).toEqual([
      { sessionId: "main-before-chat", visible: true },
      { sessionId: "main-after-switch", visible: true },
      { sessionId: "main-after-switch", visible: false }
    ])
    stopMain()
    useMainWindowSurface.setState({ sessionId: "after-cleanup" })
    await Promise.resolve()
    expect(reports).toHaveLength(3)
  } finally {
    stopMain()
    stopReports()
  }
})

test("the floating window applies main surface updates and removes the listener on cleanup", async () => {
  currentLabel = "chat"
  const stopChat = await serveChatSurface(() => {
    return Promise.reject(new Error("Surface synchronization must not navigate"))
  })
  try {
    await emitTo("chat", "chat:main-surface", { sessionId: "main-session", visible: true })
    expect(useMainWindowSurface.getState()).toEqual({ sessionId: "main-session", visible: true })
    await emitTo("chat", "chat:main-surface", { sessionId: "main-session", visible: false })
    expect(useMainWindowSurface.getState()).toEqual({ sessionId: "main-session", visible: false })
    stopChat()
    await emitTo("chat", "chat:main-surface", { sessionId: "after-cleanup", visible: true })
    expect(useMainWindowSurface.getState()).toEqual({ sessionId: "main-session", visible: false })
  } finally {
    stopChat()
  }
})

test("a chat-targeted release is handled only by the chat window", async () => {
  const mainActions: string[] = []
  const chatActions: string[] = []

  currentLabel = "main"
  const stopMain = await serveChatSurface((action) => {
    return Promise.try(() => {
      mainActions.push(action.type)
      throw new Error("Unsupported main window action")
    })
  })
  currentLabel = "chat"
  const stopChat = await serveChatSurface(async (action) => {
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

test("chat surface reports reach the main registry without invoking navigation", async () => {
  currentLabel = "main"
  const actions: string[] = []
  const stopMain = await serveChatSurface((action) => {
    return Promise.try(() => {
      actions.push(action.type)
      throw new Error("Surface reports must not navigate")
    })
  })
  try {
    currentLabel = "chat"
    await expect(
      requestChatSurface("main", { type: "surface", sessionId: "chat-session", visible: true })
    ).resolves.toBeNull()
    expect(actions).toEqual([])
    expect(useChatWindowSurface.getState()).toEqual({ sessionId: "chat-session", visible: true })
    await requestChatSurface("main", { type: "surface", sessionId: "chat-session", visible: false })
    expect(useChatWindowSurface.getState()).toEqual({ sessionId: "chat-session", visible: false })
  } finally {
    stopMain()
  }
})
