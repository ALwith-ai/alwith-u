import { commands, type ComputerStatus_Serialize as ComputerStatus } from "@alwith/module-computer/commands"
import { isTauri } from "@tauri-apps/api/core"
import { useEffect, useState } from "react"

import { text } from "@/lib/text"

import { restoreComputer } from "./operations"

/** Only native ownership is displayed; polling also observes other windows and driver exits. */
export function useComputerStatus() {
  const [status, setStatus] = useState<ComputerStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!isTauri()) return
    let disposed = false
    let hadPermissions = false
    let timer: ReturnType<typeof setTimeout>
    const refresh = async () => {
      try {
        let next = await commands.status()
        if (disposed) return
        const permitted = next.permissions.accessibility && next.permissions.screenCapture
        const newlyPermitted = permitted && !hadPermissions
        hadPermissions = permitted
        if (newlyPermitted) {
          await restoreComputer()
          next = await commands.status()
        }
        if (!disposed) {
          setStatus(next)
          setError(null)
        }
      } catch (error) {
        if (!disposed) {
          setStatus(null)
          setError(text(error))
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
