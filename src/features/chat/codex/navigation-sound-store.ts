// The navigation rail's sound settings, hydrated from preferences at boot and read
// reactively by the rail and the Appearance section (Desktop reads them via useSetting).
import { createStore } from "zustand/vanilla"
import { savePreference } from "@/lib/preferences"
import type { NavigationInstrument, NavigationSoundMode } from "./navigation-instruments"

export type NavigationSoundState = {
  soundMode: NavigationSoundMode
  instrument: NavigationInstrument
}

export const navigationSoundStore = createStore<NavigationSoundState>(() => ({
  soundMode: "scale",
  instrument: "acoustic_grand_piano"
}))

export function hydrateNavigationSound(state: NavigationSoundState): void {
  navigationSoundStore.setState(state)
}

export async function setNavigationSoundMode(soundMode: NavigationSoundMode): Promise<void> {
  navigationSoundStore.setState({ soundMode })
  await savePreference("navigationSoundMode", soundMode)
}

export async function setNavigationInstrument(instrument: NavigationInstrument): Promise<void> {
  navigationSoundStore.setState({ instrument })
  await savePreference("navigationInstrument", instrument)
}
