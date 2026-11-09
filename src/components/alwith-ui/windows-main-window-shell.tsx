import { DesktopWindowsShell, useDesktopZoom } from "@alwith/module-desktop-shell/react"
import { isTauri } from "@tauri-apps/api/core"
import { platform } from "@tauri-apps/plugin-os"
import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"

import appIcon from "../../../src-tauri/icons/64x64.png"

/** The shell's Windows title bar with U's icon and name. */
export function WindowsMainWindowShell({ children }: { children: ReactNode }): ReactNode {
  const { t } = useTranslation()
  const { level: zoom } = useDesktopZoom()
  return (
    <DesktopWindowsShell
      icon={appIcon}
      title={t("app.name")}
      zoom={zoom}
      enabled={isTauri() && platform() === "windows"}
    >
      {children}
    </DesktopWindowsShell>
  )
}
