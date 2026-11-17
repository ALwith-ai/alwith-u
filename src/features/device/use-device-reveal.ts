import { deviceBridge } from "@alwith/module-device/tauri"
import { isTauri } from "@tauri-apps/api/core"
import { useEffect, useRef } from "react"
import { toast } from "sonner"

/** Reveal new attachments once without stealing another conversation's focus or reopening a closed pane. */
export function useDeviceReveal(sessionId: string | null, reveal: () => void) {
  const seen = useRef(new Map<string, Set<string>>())
  useEffect(() => {
    if (!sessionId || !isTauri()) return
    let disposed = false
    const known = seen.current.get(sessionId) ?? new Set<string>()
    seen.current.set(sessionId, known)
    const stop = deviceBridge(sessionId).subscribe(
      (attachments) => {
        if (disposed) return
        const next = new Set(attachments.map((entry) => `${entry.udid}:${entry.attachedAt}`))
        const added = [...next].some((key) => !known.has(key))
        known.clear()
        for (const key of next) known.add(key)
        if (added) reveal()
      },
      (error) => {
        if (!disposed) toast.error(error instanceof Error ? error.message : String(error))
      }
    )
    return () => {
      disposed = true
      stop()
    }
  }, [sessionId, reveal])
}
