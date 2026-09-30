// The open thread's turns and its virtualized list API, published by ThreadView for the
// pieces that live outside it (find-in-thread reveals off-screen turns through it). ALwith
// Desktop hands the same ref around through its pane context; this app has one chat.

import type { VirtualizedTurnListApi } from "@alwith/module-chat/virtualized-turn-list"
import { createStore } from "zustand/vanilla"
import type { Turn } from "../turns"

export type ThreadRegistry = {
  sessionId: string | null
  turns: Turn[]
  api: VirtualizedTurnListApi | null
  beforeReveal: (() => void) | null
}

export const threadRegistry = createStore<ThreadRegistry>(() => ({
  sessionId: null,
  turns: [],
  api: null,
  beforeReveal: null
}))

export function publishThread(entry: ThreadRegistry): void {
  threadRegistry.setState(entry)
}

export function clearThread(sessionId: string): void {
  if (threadRegistry.getState().sessionId === sessionId)
    threadRegistry.setState({ sessionId: null, turns: [], api: null, beforeReveal: null })
}

/** A search belongs to its source session, never whichever chat was selected later. */
export async function revealThreadTurn(sessionId: string | null, key: string, signal: AbortSignal): Promise<void> {
  const entry = threadRegistry.getState()
  if (signal.aborted || sessionId === null || entry.sessionId !== sessionId || entry.api === null) return
  if (entry.beforeReveal === null) throw new Error("Mounted thread has no navigation lifecycle")
  entry.beforeReveal()
  await entry.api.scrollToKey(key, undefined, { align: "top" })
}
