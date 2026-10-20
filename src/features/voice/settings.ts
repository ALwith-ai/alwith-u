import { defaultPreferences, parsePreferences, type Provider, type VoicePreferences } from "@alwith/module-voice"
import type { VoiceSettingsHost } from "@alwith/module-voice/react"

import { commands } from "@/bindings"
import { settingsStore, updateSettings } from "@/lib/settings-store"
export type VoiceSettings = VoicePreferences
const keys: Record<keyof VoiceSettings, string> = {
  provider: "voice.provider",
  deviceId: "voice.deviceId",
  mode: "voice.inputMode",
  hotwords: "voice.hotwords",
  projectHotwords: "voice.projectHotwords",
  doubaoResourceId: "voice.doubao.resourceId",
  smooth: "voice.smooth",
  silence: "voice.silence"
}
function decode(values: Record<string, unknown>): VoiceSettings {
  const value = { ...defaultPreferences() }
  for (const [field, key] of Object.entries(keys)) {
    const saved = values[key]
    if (saved !== undefined) Object.assign(value, { [field]: saved })
  }
  return parsePreferences(value)
}
function comparable(settings: VoiceSettings): string {
  return JSON.stringify(settings, (_key, value: unknown): unknown => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return value
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
  })
}
function encode(settings: VoiceSettings): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(parsePreferences(settings)).map(([field, value]) => [keys[field as keyof VoiceSettings], value])
  )
}
export async function loadVoiceEnabled(): Promise<boolean> {
  await settingsStore.read()
  return settingsStore.get<boolean>("voice.enabled") ?? true
}
export async function saveVoiceEnabled(enabled: boolean): Promise<void> {
  await updateSettings({ "voice.enabled": enabled })
}
export async function subscribeVoiceEnabled(changed: (enabled: boolean) => void): Promise<() => void> {
  return settingsStore.subscribe((keys) => {
    if (keys.includes("voice.enabled")) changed(settingsStore.get<boolean>("voice.enabled") ?? true)
  })
}
export async function loadVoiceSettings(): Promise<VoiceSettings> {
  const snapshot = await settingsStore.read()
  return decode(snapshot.values)
}
export function voiceProfiles(): Promise<Record<Provider, boolean>> {
  return commands.voiceProfiles()
}
function deleteVoiceCredential(provider: Provider): Promise<void> {
  return commands.voiceDeleteCredential({ input: { provider } }).then(() => undefined)
}
/** The shared form calls saveCredential immediately before save. Stage only for that submit;
 * Rust commits the configuration and credential together. A host instance belongs to one form. */
export function createVoiceSettingsHost(): VoiceSettingsHost {
  let loaded: VoiceSettings | undefined
  let pending: { provider: Provider; key: string } | undefined
  return {
    async load() {
      loaded = await loadVoiceSettings()
      return loaded
    },
    profiles: voiceProfiles,
    async saveCredential(provider, key) {
      pending = { provider, key }
    },
    async save(settings) {
      const credential = pending
      pending = undefined
      if (loaded === undefined) throw new Error("Voice settings have not loaded")
      const current = await settingsStore.read()
      // Unrelated changes (theme, enabled switch) do not invalidate the voice form.
      if (comparable(decode(current.values)) !== comparable(loaded))
        throw new Error("Voice settings changed in another window; reload and retry")
      if (credential !== undefined && credential.provider !== settings.provider)
        throw new Error("Voice credential provider mismatch")
      const saved = await settingsStore.write({
        action: "saveVoice",
        changes: encode(settings),
        expectedRevision: current.revision,
        apiKey: credential?.key ?? null
      })
      loaded = decode(saved.values)
    },
    deleteCredential: deleteVoiceCredential
  }
}
