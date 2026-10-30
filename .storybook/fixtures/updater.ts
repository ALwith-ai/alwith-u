import { type UpdaterState, useUpdaterStore } from "../../src/features/updater/store"
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
  useUpdaterStore.setState({ state, initialized: true })
}
export function restartPreview(): void {
  useUpdaterStore.setState({ state: { type: "restarting", update } })
}
