import type { Session } from "@alwith/api"
import { useEffect, useRef, useState } from "react"
import { codexExtensionCapabilities, codexTurnId, composerPrediction } from "@/agent/codex-extensions"
import { client, useApp } from "@/lib/client"

/** Predictions are transient UI hints, tied to the exact source turn and model configuration. */
export function useComposerPrediction(session: Session, available: boolean, hasDraft: boolean) {
  const supported = useApp(state => codexExtensionCapabilities(state.agent).composerPredictions)
  const latestUser = session.items.findLast(item => item.kind === "user")
  const sourceTurnId = codexTurnId(latestUser?._meta)
  const key = JSON.stringify([session.id, sourceTurnId, session.configOptions])
  const requested = useRef<{ key: string; source: string } | null>(null)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const source = JSON.stringify([session.id, sourceTurnId])
  const [invalidated, setInvalidated] = useState<string | null>(null)
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null)
  const eligible =
    supported &&
    available &&
    session.state === "idle" &&
    session.lastStopReason === "end_turn" &&
    !latestUser?.replayed &&
    sourceTurnId !== null

  useEffect(() => {
    if (!eligible || hasDraft || invalidated === key || requested.current?.source === source || sourceTurnId === null)
      return
    requested.current = { key, source }
    void client.requestPrediction(session.id, sourceTurnId).catch((error: unknown) => {
      if (mounted.current && requested.current?.key === key)
        setFailure({ key, message: error instanceof Error ? error.message : String(error) })
    })
  }, [eligible, hasDraft, invalidated, key, source, session.id, sourceTurnId])

  const prediction = composerPrediction(session._meta)
  const visible =
    eligible &&
    !hasDraft &&
    invalidated !== key &&
    requested.current?.key === key &&
    prediction?.sourceTurnId === sourceTurnId
  const text = visible && prediction.result.type === "completed" ? prediction.result.text : null
  const error =
    available && session.state === "idle" && !hasDraft && invalidated !== key
      ? failure?.key === key
        ? failure.message
        : visible && prediction.result.type === "failed"
          ? "Prediction failed"
          : null
      : null
  return { text, error, invalidate: () => setInvalidated(key) }
}
