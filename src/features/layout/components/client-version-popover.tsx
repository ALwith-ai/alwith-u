import {
  DesktopStatusItem,
  type DesktopStatusItemProps,
  desktopStatusLabels
} from "@alwith/module-desktop-shell/status-item"
import { getVersion } from "@tauri-apps/api/app"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { revealItemsInDir } from "@tauri-apps/plugin-opener"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { appEnv } from "@/lib/app-env"
import { openExternal } from "@/lib/open"

export function ClientVersionPopover() {
  const { i18n } = useTranslation()
  const [clientVersion, setClientVersion] = useState<string | null>(null)
  const [cli, setCli] = useState<DesktopStatusItemProps["cli"]>(null)
  useEffect(() => {
    if (!isTauri()) return
    let active = true
    void getVersion()
      .then((value) => {
        if (active) setClientVersion(value)
      })
      .catch((error) => toast.error(String(error)))
    void invoke<DesktopStatusItemProps["cli"]>("codex_status")
      .then((value) => {
        if (active) setCli(value)
      })
      .catch((error) => toast.error(String(error)))
    return () => {
      active = false
    }
  }, [])
  const labels = desktopStatusLabels(i18n.language)
  const url = new URL(appEnv.apiBaseUrl)
  const nonProduction = url.hostname !== "api.alwith.ai"
  return (
    <DesktopStatusItem
      server={{ url: appEnv.apiBaseUrl, label: nonProduction ? labels.development : url.host, nonProduction }}
      signing={null}
      appVersion={clientVersion}
      cli={cli}
      labels={labels}
      openUrl={openExternal}
      revealPath={revealItemsInDir}
      onError={(error) => toast.error(String(error))}
    />
  )
}
