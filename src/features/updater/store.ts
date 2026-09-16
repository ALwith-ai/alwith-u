// Mirrors the Rust updater state machine into React. Checking and downloading are silent
// (Rust downloads a hit straight away); the only prompt is the native relaunch question once
// an update is ready, asked once per version. Ported from ALwith Desktop.
import { invoke, isTauri } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { ask } from "@tauri-apps/plugin-dialog"
import i18n from "i18next"
import { create } from "zustand"

export interface UpdateInfo {
  version: string
  filename: string
  signature: string
  contentLength: number | null
}

export type UpdaterState =
  | { type: "uninitialized" }
  | { type: "disabled"; reason: "invalidConfiguration" }
  | { type: "idle" }
  | { type: "checkingForUpdates" }
  | { type: "availableForDownload"; update: UpdateInfo }
  | { type: "downloading"; update: UpdateInfo; downloadedBytes: number | null; totalBytes: number | null }
  | { type: "ready"; update: UpdateInfo }
  | { type: "restarting"; update: UpdateInfo }

export const UPDATER_STATE_EVENT = "updater:state"

/** The Tauri surface the store talks to; tests pass fakes instead of mocking modules. */
export interface UpdaterIo {
  getState(): Promise<UpdaterState>
  onStateChange(handler: (state: UpdaterState) => void): Promise<() => void>
  askRelaunch(): Promise<boolean>
  installAndRelaunch(): Promise<void>
}

export interface UpdaterStore {
  state: UpdaterState
  /** init runs once per webview: fetch the current state, then follow changes. */
  initialized: boolean
  init: () => Promise<void>
  confirmInstallAndRelaunch: () => Promise<void>
}

export function createUpdaterStore(io: UpdaterIo) {
  const promptedReadyVersions = new Set<string>()

  async function confirmInstallAndRelaunch(): Promise<void> {
    if (!(await io.askRelaunch())) return
    await io.installAndRelaunch()
  }

  async function promptReadyUpdate(state: UpdaterState): Promise<void> {
    if (state.type !== "ready" || promptedReadyVersions.has(state.update.version)) return
    promptedReadyVersions.add(state.update.version)
    await confirmInstallAndRelaunch()
  }

  return create<UpdaterStore>()((set, get) => ({
    state: { type: "uninitialized" },
    initialized: false,
    init: async () => {
      if (get().initialized) return
      set({ initialized: true })
      const initial = await io.getState()
      set({ state: initial })
      await promptReadyUpdate(initial)
      await io.onStateChange(state => {
        set({ state })
        void promptReadyUpdate(state)
      })
    },
    confirmInstallAndRelaunch
  }))
}

const tauriIo: UpdaterIo = {
  getState: () => invoke<UpdaterState>("updater_get_state"),
  onStateChange: handler => listen<UpdaterState>(UPDATER_STATE_EVENT, event => handler(event.payload)),
  askRelaunch: () =>
    ask(i18n.t("updater.relaunchConfirmDesc"), {
      title: i18n.t("updater.relaunchConfirmTitle"),
      kind: "info",
      okLabel: i18n.t("updater.relaunchNow"),
      cancelLabel: i18n.t("updater.relaunchLater")
    }),
  installAndRelaunch: () => invoke<void>("updater_install_and_relaunch")
}

export const useUpdaterStore = createUpdaterStore(tauriIo)

// The relaunch prompt must fire even while the settings dialog is closed, so the webview
// starts following the Rust state as soon as this module loads (the dialog imports it at boot).
if (isTauri()) void useUpdaterStore.getState().init()
