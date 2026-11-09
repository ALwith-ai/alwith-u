import type { RunState } from "@alwith/api"
import { RUN_STATE_TEXT, SessionStateDot } from "@alwith/module-chat/session-list"
import { ImageIcon, MessageSquareIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { type InputMode, watchSessionInputMode } from "@/features/chat/composer/input-mode-preferences"

/** Session presentation follows the native preference, including changes from other windows. */
export function SessionImageIcon({
  sessionId,
  plain = false,
  state
}: {
  sessionId: string
  plain?: boolean
  state?: RunState
}) {
  const [saved, setSaved] = useState<{ sessionId: string; mode: InputMode } | null>(null)
  useEffect(() => {
    let active = true
    const report = (error: unknown) => {
      if (active) toast.error(error instanceof Error ? error.message : String(error))
    }
    const stop = watchSessionInputMode(
      sessionId,
      (mode) => {
        if (active) setSaved({ sessionId, mode })
      },
      report
    )
    void stop.catch(report)
    return () => {
      active = false
      void stop.then(
        (unlisten) => unlisten(),
        () => undefined
      )
    }
  }, [sessionId])
  if (saved?.sessionId === sessionId && saved.mode === "image")
    return <ImageIcon className={plain ? "size-4 shrink-0" : `size-3.5 shrink-0 ${RUN_STATE_TEXT.done}`} />
  return plain ? <MessageSquareIcon /> : state === "idle" ? <SessionStateDot state="idle" /> : null
}
