import { useEffect } from "react"
import { toast } from "sonner"

import { markRead, useApp } from "./client"

/** A focused window can still be showing another screen instead of its selected chat. */
export function useReadVisibleSession(
  sessionId: string | null,
  visible: boolean,
  acknowledge: (sessionId: string, version: number) => Promise<void> = markRead
): void {
  const doneVersion = useApp((app) => {
    const run = sessionId === null ? undefined : app.runStates[sessionId]
    return run?.state === "done" ? run.version : null
  })
  const readable = useApp((app) => {
    const session = sessionId === null ? undefined : app.sessions[sessionId]
    return (
      session !== undefined && !session.restoring && (session.attached || session.readOnly) && session.items.length > 0
    )
  })
  useEffect(() => {
    if (visible && readable && sessionId !== null && doneVersion !== null) {
      void acknowledge(sessionId, doneVersion).catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : String(error))
      })
    }
  }, [acknowledge, visible, readable, sessionId, doneVersion])
}
