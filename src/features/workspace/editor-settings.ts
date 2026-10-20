import { settingsStore, updateSettings } from "@/lib/settings-store"

import { type IconTheme, iconThemes } from "./workspace-state"

export interface EditorSettings {
  fontSize: number
  fontFamily: string
  fontLigatures: boolean
  wordWrap: boolean
  minimap: boolean
  lineNumbers: boolean
  renderWhitespace: boolean
}
export const defaultEditorSettings: EditorSettings = {
  fontSize: 13,
  fontFamily: "",
  fontLigatures: false,
  wordWrap: true,
  minimap: false,
  lineNumbers: true,
  renderWhitespace: false
}
function validate(value: unknown): EditorSettings {
  if (typeof value !== "object" || value === null) throw new Error("Invalid editor settings")
  const settings = value as Record<string, unknown>
  if (
    typeof settings.fontSize !== "number" ||
    !Number.isFinite(settings.fontSize) ||
    settings.fontSize < 8 ||
    settings.fontSize > 40 ||
    typeof settings.fontFamily !== "string" ||
    settings.fontFamily.length > 200 ||
    !["fontLigatures", "wordWrap", "minimap", "lineNumbers", "renderWhitespace"].every(
      (key) => typeof settings[key] === "boolean"
    )
  ) {
    throw new Error("Invalid editor settings")
  }
  return settings as unknown as EditorSettings
}
export function loadEditorSettings(): EditorSettings {
  const values = { ...defaultEditorSettings }
  for (const key of Object.keys(values) as (keyof EditorSettings)[]) {
    const value = settingsStore.get<unknown>(`editor.${key}`)
    if (value !== undefined) Object.assign(values, { [key]: value })
  }
  return validate(values)
}
export async function saveEditorSettings(settings: Partial<EditorSettings>): Promise<void> {
  validate({ ...loadEditorSettings(), ...settings })
  await updateSettings(Object.fromEntries(Object.entries(settings).map(([key, entry]) => [`editor.${key}`, entry])))
}

/** A missing global override retains each workspace's selected icon theme. */
export function loadEditorIconTheme(): IconTheme | null {
  const value = settingsStore.get<IconTheme>("editor.iconTheme")
  if (value === undefined) return null
  if (!iconThemes.includes(value)) throw new Error("Invalid file icon theme")
  return value
}
export async function saveEditorIconTheme(theme: IconTheme): Promise<void> {
  if (!iconThemes.includes(theme)) throw new Error("Invalid file icon theme")
  await updateSettings({ "editor.iconTheme": theme })
}
export function subscribeEditorSettings(listener: () => void): () => void {
  return settingsStore.subscribe((keys) => {
    if (keys.some((key) => key.startsWith("editor."))) listener()
  })
}
