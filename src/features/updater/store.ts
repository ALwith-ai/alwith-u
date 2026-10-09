// Mirrors the Rust updater state machine into React. Checking and downloading are silent
// (Rust downloads a hit straight away); the only prompt is the native relaunch question once
// an update is ready, asked once per version. Ported from ALwith Desktop.

import { ask } from "@tauri-apps/plugin-dialog"
import i18n from "i18next"
import { create } from "zustand"
import type { State as UpdaterState } from "@/bindings"
import { commands, events } from "@/bindings"

export type { State as UpdaterState } from "@/bindings"

/** The Tauri surface the store talks to; tests pass fakes instead of mocking modules. */
export interface UpdaterIo {
  getState(): Promise<UpdaterState>
  onStateChange(handler: (state: UpdaterState) => void): Promise<() => void>
  askRelaunch(): Promise<boolean>
  installAndRelaunch(): Promise<void>
}

export interface UpdaterStore {
  state: UpdaterState
  /** Subscribe before fetching state; only the main webview automatically prompts. */
  initialized: boolean
  init: (autoPrompt?: boolean) => Promise<void>
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
    init: async (autoPrompt = true) => {
      if (get().initialized) return
      set({ initialized: true })
      let receivedEvent = false
      let unsubscribe: (() => void) | undefined
      try {
        unsubscribe = await io.onStateChange(state => {
          receivedEvent = true
          set({ state })
          if (autoPrompt) void promptReadyUpdate(state)
        })
        const initial = await io.getState()
        // An event arriving during the request must not be overwritten by its snapshot.
        if (!receivedEvent) set({ state: initial })
      } catch (error) {
        unsubscribe?.()
        set({ initialized: false })
        throw error
      }
      if (autoPrompt) await promptReadyUpdate(get().state)
    },
    confirmInstallAndRelaunch
  }))
}

const tauriIo: UpdaterIo = {
  getState: () => commands.updaterGetState(),
  onStateChange: handler => events["updater:state"].listen(event => handler(event.payload)),
  askRelaunch: () =>
    ask(i18n.t("updater.relaunchConfirmDesc"), {
      title: i18n.t("updater.relaunchConfirmTitle"),
      kind: "info",
      okLabel: i18n.t("updater.relaunchNow"),
      cancelLabel: i18n.t("updater.relaunchLater")
    }),
  installAndRelaunch: async () => {
    await commands.updaterInstallAndRelaunch()
  }
}

export const useUpdaterStore = createUpdaterStore(tauriIo)

// Initialization is explicit: main owns automatic prompts, settings only observes.
