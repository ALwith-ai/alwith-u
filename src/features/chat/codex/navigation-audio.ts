export * from "@alwith/module-chat/navigation-audio"
import {
  getNavigationAudioContextState,
  getNavigationInstrumentReady,
  preloadThreadUserMessageNavigationInstrument as preloadInstrument,
  playThreadUserMessageNavigationSequence as playSequence,
  type NavigationTokenPair
} from "@alwith/module-chat/navigation-audio"
import type { NavigationInstrument, NavigationSoundMode } from "./navigation-instruments"

// DIAG: environment facts for the "no sound in the packaged app" investigation.
void import("@tauri-apps/plugin-log").then(({ info }) =>
  info(
    `[nav-audio] isSecureContext=${String(window.isSecureContext)} caches=${typeof (window as { caches?: unknown }).caches} AudioContext=${typeof AudioContext} origin=${location.origin}`
  )
)

function diag(message: string): void {
  void import("@tauri-apps/plugin-log").then(({ info }) => info(`[nav-audio] ${message}`))
}

export function preloadThreadUserMessageNavigationInstrument(instrument: NavigationInstrument) {
  void getNavigationInstrumentReady(instrument).then(
    () => diag(`instrument "${instrument}" ready; context=${getNavigationAudioContextState()}`),
    (error: unknown) => diag(`instrument "${instrument}" FAILED: ${String(error)}`)
  )
  preloadInstrument(instrument)
}

export function playThreadUserMessageNavigationSequence(
  fromIndex: number,
  toIndex: number,
  tokenPairs: NavigationTokenPair[],
  instrument: NavigationInstrument,
  mode: NavigationSoundMode
) {
  diag(
    `sequence ${fromIndex}->${toIndex} mode=${mode} instrument=${instrument} context=${getNavigationAudioContextState() ?? "none"}`
  )
  playSequence(fromIndex, toIndex, tokenPairs, instrument, mode)
}
