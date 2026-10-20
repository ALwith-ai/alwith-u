// Preferences live in one store file shared by every window. A change made in one window
// (the settings window) is broadcast as `preferences:changed`; each window applies what
// concerns it (ALwith Desktop does the same through its store-changed events).
import { listen } from "@tauri-apps/api/event"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"

import { navigationSoundStore } from "@/features/chat/codex/navigation-sound-store"
import { predictionPreference } from "@/features/chat/composer/prediction-preference"
import i18n, { isLanguageCode } from "@/lib/i18n"
import { type PreferenceChange, PREFERENCES_CHANGED } from "@/lib/preferences"
import { syncZoomLevel } from "@/lib/zoom"

import { setProjectAppPreference } from "./project-app-preference"

export function startPreferenceSync(): Promise<() => void> {
  return listen<PreferenceChange>(PREFERENCES_CHANGED, async event => {
    // Broadcasts reach the sender too; it already applied the change itself.
    if (event.payload.window === getCurrentWebviewWindow().label) return
    const change = event.payload
    switch (change.key) {
      case "composerPredictions":
        if (typeof change.value !== "boolean") throw new Error("Invalid composer prediction preference")
        predictionPreference.setState({ enabled: change.value })
        return
      case "externalEditor":
        if (change.value === null || typeof change.value === "string") setProjectAppPreference(change.value)
        return
      case "language": {
        const language = change.value
        if (typeof language === "string" && isLanguageCode(language)) await i18n.changeLanguage(language)
        return
      }
      case "zoomLevel": {
        if (change.value !== null && typeof change.value !== "number") throw new Error("Invalid zoom preference")
        await syncZoomLevel(change.value ?? 1)
        return
      }
      case "navigationSoundMode":
        navigationSoundStore.setState({ soundMode: change.value as never })
        return
      case "navigationInstrument":
        navigationSoundStore.setState({ instrument: change.value as never })
        return
      default:
        return
    }
  })
}
