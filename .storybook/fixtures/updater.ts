import type { DesktopUpdaterState as UpdaterState } from "@alwith/module-desktop-shell"
import { emit } from "@tauri-apps/api/event"
export let updaterState: UpdaterState = { type: "idle" }
function publish(state: UpdaterState): void {
  updaterState = state
  void emit("alwith-desktop-shell:updater-state", state)
}
export type UpdateCase =
  "idle" | "disabled" | "checkingForUpdates" | "downloading" | "indeterminate" | "ready" | "restarting"
const update = {
  version: "0.2.15",
  filename: "ALwith-U.app.tar.gz",
  signature: "storybook",
  contentLength: 100_000_000
}
export function resetUpdater(kind: UpdateCase = "idle"): void {
  const state: UpdaterState =
    kind === "disabled"
      ? { type: kind, reason: "invalidConfiguration" }
      : kind === "downloading" || kind === "indeterminate"
        ? {
            type: "downloading",
            update,
            downloadedBytes: kind === "indeterminate" ? null : 42_000_000,
            totalBytes: kind === "indeterminate" ? null : 100_000_000
          }
        : kind === "ready" || kind === "restarting"
          ? { type: kind, update }
          : { type: kind }
  publish(state)
}
export function restartPreview(): void {
  publish({ type: "restarting", update })
}
