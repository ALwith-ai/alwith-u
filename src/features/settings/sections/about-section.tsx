import { getVersion } from "@tauri-apps/api/app"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { useUpdaterStore } from "@/features/updater/store"
import { SettingGroup, SettingRow } from "./shared"

export function AboutSection() {
  const [clientVersion, setClientVersion] = useState<string | null>(null)
  const [cliVersion, setCliVersion] = useState<string | null>(null)
  useEffect(() => {
    if (!isTauri()) return
    let disposed = false
    void Promise.allSettled([getVersion(), invoke<string>("codex_version")]).then(([client, cli]) => {
      if (disposed) return
      if (client.status === "fulfilled") setClientVersion(client.value)
      if (cli.status === "fulfilled") setCliVersion(cli.value)
      for (const result of [client, cli]) {
        if (result.status === "rejected") {
          const error: unknown = result.reason
          toast.error(error instanceof Error ? error.message : String(error))
        }
      }
    })
    return () => {
      disposed = true
    }
  }, [])
  useEffect(() => {
    if (!isTauri()) return
    void useUpdaterStore
      .getState()
      .init(false)
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : String(error)))
  }, [])
  const { t } = useTranslation()
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
      <SettingRow
        title={t("settings.updates")}
        desc={`${updaterText} ${clientVersion === null ? "—" : `v${clientVersion}`}`}>
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
      <SettingRow title={t("settings.engine")}>
        <span className="text-muted-foreground text-sm">
          {t("settings.codexVersion", { version: cliVersion ?? "—" })}
        </span>
      </SettingRow>
      <Separator />
      <SettingRow title={t("settings.licensesTitle")} desc={t("settings.licenses")} />
    </SettingGroup>
  )
}
