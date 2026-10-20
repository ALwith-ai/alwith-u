import { isTauri } from "@tauri-apps/api/core"
import { useEffect, useState } from "react"

import { commands, type ComputerStatus } from "@/bindings"

/** Only native ownership is displayed; polling also observes other windows and driver exits. */
export function useComputerStatus() {
  const [status, setStatus] = useState<ComputerStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!isTauri()) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    const refresh = async () => {
      try {
        const next = await commands.computerStatus()
        if (!disposed) {
          setStatus(next)
          setError(null)
        }
      } catch (error) {
        if (!disposed) {
          setStatus(null)
          setError(String(error))
        }
      } finally {
        if (!disposed) timer = setTimeout(() => void refresh(), 1000)
      }
    }
    void refresh()
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [])
  return { status, error }
}
