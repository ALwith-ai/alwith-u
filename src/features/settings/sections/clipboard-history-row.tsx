import { useEffect, useState, useSyncExternalStore } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { commands } from "@/bindings"
import { Switch } from "@/components/ui/switch"
import { settingsStore, updateSettings } from "@/lib/settings-store"

import { SettingRow } from "./shared"

const subscribe = (notify: () => void) => settingsStore.subscribe(notify)
const read = () => settingsStore.get<boolean>("clipboard.enabled") === true

/** Shown only where the platform can keep a clipboard history. */
export function ClipboardHistoryRow() {
  const { t } = useTranslation()
  const enabled = useSyncExternalStore(subscribe, read)
  const [supported, setSupported] = useState(false)
  const [pending, setPending] = useState(false)
  useEffect(() => {
    void commands.clipboardSupported().then(setSupported)
  }, [])
  if (!supported) return null
  return (
    <SettingRow title={t("settings.clipboardHistory")} desc={t("settings.clipboardHistoryDesc")}>
      <Switch
        aria-label={t("settings.clipboardHistory")}
        checked={enabled}
        disabled={pending}
        onCheckedChange={(value) => {
          setPending(true)
          void updateSettings({ "clipboard.enabled": value })
            .catch((error: unknown) => toast.error(String(error)))
            .finally(() => setPending(false))
        }}
      />
    </SettingRow>
  )
}
