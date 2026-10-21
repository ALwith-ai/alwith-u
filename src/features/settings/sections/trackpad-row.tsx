import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Switch } from "@/components/ui/switch"
import { setThreeFingerSwipeEnabled, trackpadPlatform, useThreeFingerSwipeEnabled } from "@/lib/trackpad-preference"

import { SettingRow } from "./shared"

export function TrackpadRow() {
  const { t } = useTranslation()
  const enabled = useThreeFingerSwipeEnabled()
  const platform = trackpadPlatform()
  const [saving, setSaving] = useState(false)
  return (
    <SettingRow title={t("settings.threeFingerSwipe")} desc={t(`settings.threeFingerSwipeGuidance.${platform}`)}>
      <Switch
        aria-label={t("settings.threeFingerSwipe")}
        checked={enabled}
        disabled={platform === "unsupported" || saving}
        onCheckedChange={(checked) => {
          setSaving(true)
          void setThreeFingerSwipeEnabled(checked)
            .catch((error: unknown) => toast.error(error instanceof Error ? error.message : String(error)))
            .finally(() => setSaving(false))
        }}
      />
    </SettingRow>
  )
}
