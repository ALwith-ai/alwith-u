import { defaultPreferences, parsePreferences, type Provider, type VoicePreferences } from "@alwith/module-voice"
import { commands } from "@/bindings"
import { LazyStore } from "@tauri-apps/plugin-store"
export type VoiceSettings = VoicePreferences
const store = new LazyStore("voice-settings.json")
export async function loadVoiceSettings(): Promise<VoiceSettings> {
  const settings = await store.get<unknown>("settings")
  return settings === null || settings === undefined ? defaultPreferences() : parsePreferences(settings)
}
export async function saveVoiceSettings(settings: VoiceSettings): Promise<void> {
  await store.set("settings", settings)
  await store.save()
}
export function voiceProfiles(): Promise<Record<Provider, boolean>> {
  return commands.voiceProfiles()
}
export function saveVoiceCredential(provider: Provider, apiKey: string): Promise<void> {
  return commands.voiceSaveCredential({ input: { provider, apiKey } }).then(() => undefined)
}
export function deleteVoiceCredential(provider: Provider): Promise<void> {
  return commands.voiceDeleteCredential({ input: { provider } }).then(() => undefined)
}
