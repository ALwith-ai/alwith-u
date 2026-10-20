import { useEffect, useState } from "react"
import { toast } from "sonner"

import { loadVoiceEnabled, subscribeVoiceEnabled } from "./settings"

export function useVoiceEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  useEffect(() => {
    let active = true
    let changed = false
    let stop: (() => void) | undefined
    void (async () => {
      try {
        const unsubscribe = await subscribeVoiceEnabled((value) => {
          changed = true
          if (active) setEnabled(value)
        })
        if (!active) {
          unsubscribe()
          return
        }
        stop = unsubscribe
        const value = await loadVoiceEnabled()
        // A cross-window update received during the read is newer than that snapshot.
        if (active && !changed) setEnabled(value)
      } catch (error: unknown) {
        if (active) toast.error(error instanceof Error ? error.message : String(error))
      }
    })()
    return () => {
      active = false
      stop?.()
    }
  }, [])
  return enabled
}
