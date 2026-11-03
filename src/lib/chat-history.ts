import type { Store } from "@alwith/api/client"
import type { CodexClientState, SessionSummary } from "@alwith/module-chat/client"

import { isImageSession } from "@/agent/session-kind"

const projections = new WeakMap<CodexClientState, CodexClientState>()
const lists = new WeakMap<SessionSummary[], SessionSummary[]>()

function ordinaryRows(rows: SessionSummary[]): SessionSummary[] {
  const cached = lists.get(rows)
  if (cached) return cached
  const filtered = rows.filter((row) => !isImageSession(row))
  const result = filtered.length === rows.length ? rows : filtered
  lists.set(rows, result)
  return result
}

/** Presentation only: the underlying client retains every Codex conversation. */
export function chatHistoryState<T extends CodexClientState>(state: T): T {
  const cached = projections.get(state)
  if (cached) return cached as T
  const imageIds = new Set(
    [...state.sessionList, ...state.archivedSessions].filter(isImageSession).map((row) => row.sessionId)
  )
  const projected = {
    ...state,
    sessionList: ordinaryRows(state.sessionList),
    archivedSessions: ordinaryRows(state.archivedSessions),
    runStates: imageIds.size
      ? Object.fromEntries(Object.entries(state.runStates).filter(([id]) => !imageIds.has(id)))
      : state.runStates
  }
  projections.set(state, projected)
  return projected
}

export function chatHistoryStore<T extends CodexClientState>(store: Store<T>): Store<T> {
  return {
    getState: () => chatHistoryState(store.getState()),
    getInitialState: () => chatHistoryState(store.getInitialState()),
    setState: (next, replace) => store.setState(next, replace),
    subscribe: (listener) =>
      store.subscribe((state, previous) => listener(chatHistoryState(state), chatHistoryState(previous)))
  }
}
