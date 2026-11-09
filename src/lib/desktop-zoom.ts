import { clampZoomLevel, initializeDesktopZoom } from "@alwith/module-desktop-shell/zoom"

import { settingsStore, updateSettings } from "./settings-store"

/** Move U's saved zoom into the shell before it restores the page, preserving a shell override. */
export async function initializeZoom(): Promise<void> {
  const legacy = settingsStore.get<number>("appearance.zoomLevel")
  if (legacy !== undefined && localStorage.getItem("alwith-desktop-shell.zoom") === null) {
    localStorage.setItem("alwith-desktop-shell.zoom", String(clampZoomLevel(legacy)))
  }
  await initializeDesktopZoom()
  // Keep the legacy value if initialization fails, so a later startup can retry the migration.
  if (legacy !== undefined) await updateSettings({ "appearance.zoomLevel": null })
}
