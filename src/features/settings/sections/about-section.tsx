import { useTranslation } from "react-i18next"
import { isTauri } from "@tauri-apps/api/core"
import { useEffect } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { useUpdaterStore } from "@/features/updater/store"
import { useSettingsAgent } from "@/lib/settings-bridge"
import { SettingGroup, SettingRow } from "./shared"

export function AboutSection() {
  useEffect(() => {
    if (!isTauri()) return
    void useUpdaterStore
      .getState()
      .init(false)
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : String(error)))
  }, [])
  const { t } = useTranslation()
  const agent = useSettingsAgent()
  const state = useUpdaterStore(store => store.state)
  const confirmInstallAndRelaunch = useUpdaterStore(store => store.confirmInstallAndRelaunch)

  // Checks and downloads are silent; the row only says where the updater stands.
  const updaterText = (() => {
    switch (state.type) {
      case "ready":
      case "restarting":
        return t("updater.readyDesc", { version: state.update.version })
      case "downloading": {
        const total = state.totalBytes ?? 0
        const percent = total > 0 ? Math.min(Math.round(((state.downloadedBytes ?? 0) / total) * 100), 100) : 0
        return t("updater.downloading", { percent })
      }
      case "checkingForUpdates":
        return t("updater.checking")
      case "disabled":
        return t("updater.disabled")
      default:
        return t("updater.upToDate")
    }
  })()

  return (
    <SettingGroup>
      <SettingRow title={t("settings.updates")} desc={updaterText}>
        {(state.type === "ready" || state.type === "restarting") && (
          <Button
            variant="outline"
            size="sm"
            disabled={state.type === "restarting"}
            onClick={() => {
              confirmInstallAndRelaunch().catch((error: unknown) =>
                toast.error(error instanceof Error ? error.message : String(error))
              )
            }}>
            {t("updater.ready", { version: state.update.version })}
          </Button>
        )}
      </SettingRow>
      <Separator />
      {agent != null && (
        <>
          <SettingRow title={t("settings.engine")}>
            <span className="text-muted-foreground text-sm">
              {agent.name} {agent.version}
            </span>
          </SettingRow>
          <Separator />
        </>
      )}
      <SettingRow title={t("settings.licensesTitle")} desc={t("settings.licenses")} />
    </SettingGroup>
  )
}
