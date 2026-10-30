import { useState, useSyncExternalStore } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Switch } from "@/components/ui/switch"
import {
  loadExplorerShowHidden,
  saveExplorerShowHidden,
  subscribeExplorerSettings
} from "@/features/workspace/explorer-settings"

import { SettingGroup, SettingRow } from "./shared"

export function ExplorerSection() {
  const { t } = useTranslation()
  const showHidden = useSyncExternalStore(subscribeExplorerSettings, loadExplorerShowHidden)
  const [saving, setSaving] = useState(false)
  return (
    <SettingGroup>
      <SettingRow title={t("workspace.hidden")} desc={t("settings.explorerHiddenDescription")}>
        <Switch
          aria-label={t("workspace.hidden")}
          checked={showHidden}
          disabled={saving}
          onCheckedChange={(value) => {
            setSaving(true)
            void saveExplorerShowHidden(value)
              .catch((error: unknown) => toast.error(error instanceof Error ? error.message : String(error)))
              .finally(() => setSaving(false))
          }}
        />
      </SettingRow>
    </SettingGroup>
  )
}
