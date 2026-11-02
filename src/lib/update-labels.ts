import type { DesktopUpdateLabels } from "@alwith/module-desktop-shell/react"
import type { TFunction } from "i18next"

/** U's translations for the shell's update card and relaunch question. */
export function updateLabels(t: TFunction): DesktopUpdateLabels {
  return {
    downloading: t("updater.downloading", { percent: "{{percent}}", interpolation: { escapeValue: false } }),
    installing: t("updater.installing"),
    install: t("updater.install"),
    relaunchTitle: t("updater.relaunchConfirmTitle"),
    relaunchDescription: t("updater.relaunchConfirmDesc"),
    relaunchNow: t("updater.relaunchNow"),
    relaunchLater: t("updater.relaunchLater")
  }
}
