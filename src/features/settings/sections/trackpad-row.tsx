import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Switch } from "@/components/ui/switch"
import {
  setThreeFingerSwipeEnabled,
  setTrackpadEnabled,
  trackpadPlatform,
  useThreeFingerSwipeSelected,
  useTrackpadEnabled
} from "@/lib/trackpad-preference"

import { SettingGroup, SettingRow } from "./shared"

/** The master switch preserves the user's gesture selection, as in Desktop. */
export function TrackpadRow() {
  const { t } = useTranslation()
  const enabled = useThreeFingerSwipeSelected()
  const master = useTrackpadEnabled()
  const platform = trackpadPlatform()
  const [saving, setSaving] = useState(false)
  const save = (write: () => Promise<void>) => {
    setSaving(true)
    void write()
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : String(error)))
      .finally(() => setSaving(false))
  }
  return (
    <SettingGroup>
      <SettingRow title={t("settings.trackpadEnabled")}>
        <Switch
          aria-label={t("settings.trackpadEnabled")}
          checked={master}
          disabled={platform === "unsupported" || saving}
          onCheckedChange={(checked) => save(() => setTrackpadEnabled(checked))}
        />
      </SettingRow>
      <SettingRow
        title={t("settings.threeFingerSwipe")}
        desc={
          enabled || platform === "unsupported"
            ? t(`settings.threeFingerSwipeGuidance.${platform}`)
            : t("settings.threeFingerSwipeDesc")
        }
      >
        <Switch
          aria-label={t("settings.threeFingerSwipe")}
          checked={enabled}
          disabled={!master || saving}
          onCheckedChange={(checked) => save(() => setThreeFingerSwipeEnabled(checked))}
        />
      </SettingRow>
    </SettingGroup>
  )
}
