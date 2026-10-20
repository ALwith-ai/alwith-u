import type { SessionRunState } from "@alwith/api"

import type { AppState } from "@/agent/client"

/** Return only conversations already open in main; Runtime also reports other clients' sessions. */
export function recentMainActivity(state: AppState, departingId: string | null): SessionRunState | null {
  let recent: SessionRunState | null = null
  for (const record of Object.values(state.runStates)) {
    const id = record.sessionId
    if (
      id === departingId ||
      record.reusableDraft ||
      state.draftSessions[id] ||
      state.sessionWindows[id] !== "main" ||
      !state.sessions[id]?.attached
    )
      continue
    if (recent === null || record.lastActivityAt > recent.lastActivityAt) recent = record
  }
  return recent
}
