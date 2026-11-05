import type { CodexClientState } from "@alwith/module-chat/client"
import type { SessionListClient } from "@alwith/module-chat/session-list"

import { client } from "@/lib/client"

import { useActivityOrder } from "./activity-order"

let source: CodexClientState | undefined
let order: readonly string[] | undefined
let projected: CodexClientState | undefined

/** Only the list's activity controls are projected; conversation state stays on the real client. */
function snapshot(): CodexClientState {
  const state = client.state
  const ids = useActivityOrder.getState().ids
  if (projected && source === state && order === ids) return projected
  source = state
  order = ids
  projected = {
    ...state,
    runStates: Object.fromEntries(ids.flatMap((id) => (state.runStates[id] ? [[id, state.runStates[id]]] : [])))
  }
  return projected
}

const initial = snapshot()

export const sessionListClient: SessionListClient = {
  get state() {
    return snapshot()
  },
  store: {
    getState: snapshot,
    getInitialState: () => initial,
    setState: (): never => {
      throw new Error("Session list state is read-only")
    },
    subscribe(listener) {
      let previous = snapshot()
      const notify = (): void => {
        const next = snapshot()
        if (next === previous) return
        const before = previous
        previous = next
        listener(next, before)
      }
      const stopState = client.store.subscribe(notify)
      const stopOrder = useActivityOrder.subscribe(notify)
      return () => {
        stopState()
        stopOrder()
      }
    }
  },
  listSessions: (options): Promise<void> => client.listSessions(options),
  listArchived: (options): Promise<void> => client.listArchived(options),
  renameSession: (id, name): Promise<void> => client.renameSession(id, name),
  fork: (id, cwd): Promise<string> => client.fork(id, cwd),
  archive: (id): Promise<void> => client.archive(id),
  unarchive: (id): Promise<void> => client.unarchive(id),
  delete: (id): Promise<void> => client.delete(id),
  stopSession: (id): Promise<void> => client.stopSession(id),
  activityReply: (id): Promise<string | null> => client.activityReply(id),
  projectPath: (cwd): string => client.projectPath(cwd)
}
