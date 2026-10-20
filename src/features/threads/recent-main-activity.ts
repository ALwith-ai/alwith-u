import type { SessionRunState } from "@alwith/api"

import type { AppState } from "@/agent/client"

/** Fill a vacated main surface without pulling a conversation out of the floating window. */
export function recentMainActivity(state: AppState, departingId: string | null): SessionRunState | null {
  let recent: SessionRunState | null = null
  for (const record of Object.values(state.runStates)) {
    const id = record.sessionId
    if (id === departingId || record.reusableDraft || state.draftSessions[id] || state.sessionWindows[id] === "chat")
      continue
    if (recent === null || record.lastActivityAt > recent.lastActivityAt) recent = record
  }
  return recent
}
