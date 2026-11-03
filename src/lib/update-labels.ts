import type { DesktopUpdateLabels } from "@alwith/module-desktop-shell/react"
import type { TFunction } from "i18next"

/** U's translations for the shell's update card and relaunch question; the shell supplies the rest. */
export function updateLabels(t: TFunction): Partial<DesktopUpdateLabels> {
  return {
    checking: t("updater.checking"),
    disabled: t("updater.disabled"),
    upToDate: t("updater.upToDate"),
    ready: t("updater.ready", { version: "{{version}}", interpolation: { escapeValue: false } }),
    downloading: t("updater.downloading", { percent: "{{percent}}", interpolation: { escapeValue: false } }),
    installing: t("updater.installing"),
    install: t("updater.install"),
    relaunchTitle: t("updater.relaunchConfirmTitle"),
    relaunchDescription: t("updater.relaunchConfirmDesc"),
    relaunchNow: t("updater.relaunchNow"),
    relaunchLater: t("updater.relaunchLater")
  }
}
