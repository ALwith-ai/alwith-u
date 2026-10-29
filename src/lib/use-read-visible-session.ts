import { useEffect } from "react"
import { toast } from "sonner"

import { markRead, useApp } from "./client"

/** A focused window can still be showing another screen instead of its selected chat. */
export function useReadVisibleSession(sessionId: string | null, visible: boolean): void {
  const state = useApp((app) => (sessionId === null ? null : app.runStates[sessionId]?.state))
  const readable = useApp((app) => {
    const session = sessionId === null ? undefined : app.sessions[sessionId]
    return (
      session !== undefined && !session.restoring && (session.attached || session.readOnly) && session.items.length > 0
    )
  })
  useEffect(() => {
    if (visible && readable && sessionId !== null && state === "done") {
      void markRead(sessionId).catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : String(error))
      })
    }
  }, [visible, readable, sessionId, state])
}
