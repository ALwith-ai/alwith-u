// Small per-user preferences. Codex owns every conversation; this file only
// remembers what the user was looking at and which language they chose.
import { emit } from "@tauri-apps/api/event"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { LazyStore } from "@tauri-apps/plugin-store"
import type { NavigationInstrument, NavigationSoundMode } from "@/features/chat/codex/navigation-instruments"

export type Preferences = {
  lastProjectDirectory: string | null
  language: string | null
  zoomLevel: number | null
  /**
   * Session id → gateway model id for threads the user moved to DeepSeek. Codex only records
   * the provider a thread was created with, so a moved thread is resumed with this hint.
   */
  sessionModels: Record<string, string>
  /** Sounds the user-message navigation rail plays (ALwith Desktop's navigation melody). */
  navigationSoundMode: NavigationSoundMode
  navigationInstrument: NavigationInstrument
  /** Bundle id (Windows: exe path) of the app "Open in …" last used for a project. */
  externalEditor: string | null
}

const store = new LazyStore("preferences.json")

export async function loadPreferences(): Promise<Preferences> {
  const [
    lastProjectDirectory,
    language,
    zoomLevel,
    sessionModels,
    navigationSoundMode,
    navigationInstrument,
    externalEditor
  ] = await Promise.all([
    store.get<string>("lastProjectDirectory"),
    store.get<string>("language"),
    store.get<number>("zoomLevel"),
    store.get<Record<string, string>>("sessionModels"),
    store.get<NavigationSoundMode>("navigationSoundMode"),
    store.get<NavigationInstrument>("navigationInstrument"),
    store.get<string>("externalEditor")
  ])
  return {
    lastProjectDirectory: lastProjectDirectory ?? null,
    language: language ?? null,
    zoomLevel: zoomLevel ?? null,
    sessionModels: sessionModels ?? {},
    navigationSoundMode: navigationSoundMode ?? "scale",
    navigationInstrument: navigationInstrument ?? "acoustic_grand_piano",
    externalEditor: externalEditor ?? null
  }
}

/** Broadcast after every save so the other window follows (see `preference-sync.ts`). */
export const PREFERENCES_CHANGED = "preferences:changed"
export type PreferenceChange = { key: keyof Preferences; value: unknown; window: string }

export async function savePreference<K extends keyof Preferences>(key: K, value: Preferences[K]): Promise<void> {
  if (value === null) await store.delete(key)
  else await store.set(key, value)
  await store.save()
  const change: PreferenceChange = { key, value, window: getCurrentWebviewWindow().label }
  await emit(PREFERENCES_CHANGED, change)
}
