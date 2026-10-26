import { useState, useSyncExternalStore } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Switch } from "@/components/ui/switch"
import { settingsStore, updateSettings } from "@/lib/settings-store"

import { SettingRow } from "./shared"

const subscribe = (notify: () => void) => settingsStore.subscribe(notify)
const read = () => settingsStore.get<boolean>("system.preventSleep") === true

export function PreventSleepRow() {
  const { t } = useTranslation()
  const enabled = useSyncExternalStore(subscribe, read)
  const [pending, setPending] = useState(false)
  return (
    <SettingRow title={t("settings.preventSleep")} desc={t("settings.preventSleepDesc")}>
      <Switch
        aria-label={t("settings.preventSleep")}
        checked={enabled}
        disabled={pending}
        onCheckedChange={(value) => {
          setPending(true)
          void updateSettings({ "system.preventSleep": value })
            .catch((error: unknown) => toast.error(String(error)))
            .finally(() => setPending(false))
        }}
      />
    </SettingRow>
  )
}
