import { isTauri } from "@tauri-apps/api/core"
import { MonitorIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { commands, type ComputerStatus } from "@/bindings"
import { Button } from "@/components/ui/button"
import { openSettingsWindow } from "@/lib/window-manager"
function report(error: unknown) {
  toast.error(error instanceof Error ? error.message : String(error))
}

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

export function ComputerControl() {
  const { t } = useTranslation()
  if (!isTauri()) return null
  return (
    <Button size="sm" variant="ghost" onClick={() => void openSettingsWindow("computer").catch(report)}>
      <MonitorIcon />
      {t("computer.title")}
    </Button>
  )
}
