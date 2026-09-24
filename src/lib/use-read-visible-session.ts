import { useEffect } from "react"
import { toast } from "sonner"
import { markRead, useApp } from "./client"

/** A focused window can still be showing another screen instead of its selected chat. */
export function useReadVisibleSession(sessionId: string | null, visible: boolean): void {
  const state = useApp(app => (sessionId === null ? null : app.runStates[sessionId]?.state))
  useEffect(() => {
    if (visible && sessionId !== null && state === "done") {
      void markRead(sessionId).catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : String(error))
      })
    }
  }, [visible, sessionId, state])
}
