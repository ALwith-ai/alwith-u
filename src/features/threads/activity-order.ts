import { create } from "zustand"

import type { AppState } from "@/agent/client"
import { client } from "@/lib/client"

// Display order only, kept across panel mounts. Runtime remains the authority for membership.
export const useActivityOrder = create<{ ids: string[] }>(() => ({ ids: [] }))

function reconcile(state: AppState): void {
  const eligible = new Set(
    Object.values(state.runStates)
      .filter(record => !record.reusableDraft && !state.draftSessions[record.sessionId])
      .map(record => record.sessionId)
  )
  const previous = useActivityOrder.getState().ids
  const next = previous.filter(id => eligible.delete(id))
  next.push(...eligible)
  if (next.length !== previous.length || next.some((id, index) => id !== previous[index])) {
    useActivityOrder.setState({ ids: next })
  }
}

reconcile(client.state)
const unsubscribe = client.store.subscribe(reconcile)
if (import.meta.hot) import.meta.hot.dispose(unsubscribe)
