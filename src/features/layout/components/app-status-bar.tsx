import {
  DesktopStatusBar,
  type DesktopStatusItemProps,
  desktopStatusLabels
} from "@alwith/module-desktop-shell/status-item"
import { invoke } from "@tauri-apps/api/core"
import { revealItemsInDir } from "@tauri-apps/plugin-opener"
import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { appEnv } from "@/lib/app-env"
import { openExternal } from "@/lib/open"

/** The shell's status bar with U's server, the Runtime's Codex CLI, and host slots. */
export function AppStatusBar({ start, end }: { start?: ReactNode; end?: ReactNode }) {
  const { i18n } = useTranslation()
  const url = new URL(appEnv.apiBaseUrl)
  const nonProduction = url.hostname !== "api.alwith.ai"
  return (
    <DesktopStatusBar
      server={{
        url: appEnv.apiBaseUrl,
        label: nonProduction ? desktopStatusLabels(i18n.language).development : url.host,
        nonProduction
      }}
      readCli={() => invoke<DesktopStatusItemProps["cli"]>("codex_status")}
      openUrl={openExternal}
      revealPath={revealItemsInDir}
      onError={(error) => toast.error(String(error))}
      start={start}
      end={end}
    />
  )
}
