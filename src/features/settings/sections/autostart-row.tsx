import { LoaderCircleIcon } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { commands } from "@/bindings"
import { Switch } from "@/components/ui/switch"

import { SettingRow } from "./shared"

/** Desktop's system login item is the source of truth; no second preference is stored. */
export function AutostartRow() {
  const { t } = useTranslation()
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [pending, setPending] = useState(true)
  const [supported, setSupported] = useState(true)
  const working = useRef(false)
  const mounted = useRef(false)
  const read = useCallback(async (value?: boolean) => {
    if (working.current) return
    working.current = true
    setPending(true)
    try {
      if (value !== undefined) await commands.autostartSet({ enabled: value })
      const actual = await commands.autostartStatus()
      if (mounted.current) {
        setEnabled(actual.enabled)
        setSupported(actual.supported)
      }
    } catch (error) {
      if (mounted.current) {
        setEnabled(null)
        toast.error(error instanceof Error ? error.message : String(error))
      }
    } finally {
      working.current = false
      if (mounted.current) setPending(false)
    }
  }, [])
  useEffect(() => {
    mounted.current = true
    const refresh = () => void read()
    refresh()
    window.addEventListener("focus", refresh)
    return () => {
      mounted.current = false
      window.removeEventListener("focus", refresh)
    }
  }, [read])
  return (
    <SettingRow title={t("settings.petAutostart")} desc={supported ? undefined : t("settings.petAutostartInstalled")}>
      <div className="flex items-center gap-2">
        {pending && <LoaderCircleIcon className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />}
        <Switch
          aria-label={t("settings.petAutostart")}
          checked={enabled === true}
          disabled={pending || enabled === null || !supported}
          onCheckedChange={value => void read(value)}
        />
      </div>
    </SettingRow>
  )
}
