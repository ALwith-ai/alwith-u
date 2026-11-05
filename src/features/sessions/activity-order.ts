import { sessionNavigationStore } from "@alwith/module-chat/session-list"
import { create } from "zustand"

import { client } from "@/lib/client"

const navigation = sessionNavigationStore(client)
export const useActivityOrder = create<{ ids: string[] }>(() => ({ ids: [] }))

// Shared activity events and locally completed attachments both admit sessions.
// A startup Runtime record alone never admits historical conversations.
function reconcile(): void {
  const state = client.state
  const eligible = new Set(
    navigation.get().activityOrder.filter((id) => {
      const record = state.runStates[id]
      // Startup broadcasts can contain historical records with no remaining connection.
      return record !== undefined && record.owner !== ""
    })
  )
  for (const session of Object.values(state.sessions)) {
    if (session.attached && !session.restoring && !session.readOnly) eligible.add(session.id)
  }
  for (const id of eligible) {
    const record = state.runStates[id]
    if (!record || (record.reusableDraft && state.draftSessions[id] === undefined)) eligible.delete(id)
  }
  const previous = useActivityOrder.getState().ids
  const ids = previous.filter((id) => eligible.delete(id))
  ids.push(...eligible)
  if (ids.length !== previous.length || ids.some((id, index) => id !== previous[index])) {
    useActivityOrder.setState({ ids })
  }
}

reconcile()
const stopNavigation = navigation.subscribe(reconcile)
const stopState = client.store.subscribe(reconcile)
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    stopNavigation()
    stopState()
  })
