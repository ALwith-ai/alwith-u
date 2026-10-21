import { create } from "zustand"

/** A transient projection reported by the chat window, independent of login and pets. */
export type ChatWindowSurface = { sessionId: string | null; visible: boolean }
export const useChatWindowSurface = create<ChatWindowSurface>(() => ({ sessionId: null, visible: false }))

/** Main reports its displayed conversation to the floating window without persisting UI state. */
export const useMainWindowSurface = create<ChatWindowSurface>(() => ({ sessionId: null, visible: false }))
