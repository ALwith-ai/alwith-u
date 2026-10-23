import { useEffect, useState } from "react"

import { latestAssistantReply } from "@/agent/activity-preview"
import { client, useApp } from "@/lib/client"
import type { RunState } from "@/lib/run-state"

/** Keep only an ephemeral row preview; Codex remains the history owner. */
export function useActivityPreview(sessionId: string, state: RunState): string | undefined {
  const connection = useApp((store) => store.connection)
  const attached = useApp(
    (store) => Boolean(store.sessions[sessionId]?.attached) && !store.sessions[sessionId]?.restoring
  )
  const live = useApp((store) => latestAssistantReply(store.sessions[sessionId]?.items))
  const draft = useApp((store) => Boolean(store.runStates[sessionId]?.reusableDraft))
  const [preview, setPreview] = useState<string>()
  useEffect(() => {
    if (connection !== "ready" || draft || attached) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let failures = 0
    const refresh = async () => {
      try {
        const text = await client.activityReply(sessionId)
        failures = 0
        if (!cancelled) setPreview(text ?? undefined)
      } catch {
        // A running thread may not have persisted its first item yet. Retry without opening it.
        failures++
      } finally {
        if (!cancelled && (state === "running" || (failures > 0 && failures < 3)))
          timer = setTimeout(() => void refresh(), 5000)
      }
    }
    void refresh()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [sessionId, connection, draft, attached, state])
  return attached ? live : (preview ?? live)
}
