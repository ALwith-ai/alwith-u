import { iconThemes, type IconTheme } from "./workspace-state"

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
      key => typeof settings[key] === "boolean"
    )
  ) {
    throw new Error("Invalid editor settings")
  }
  return settings as unknown as EditorSettings
}
export function loadEditorSettings(): EditorSettings {
  const raw = localStorage.getItem("workspace:editor-settings")
  return raw === null ? defaultEditorSettings : validate(JSON.parse(raw))
}
export function saveEditorSettings(settings: EditorSettings): void {
  localStorage.setItem("workspace:editor-settings", JSON.stringify(validate(settings)))
  window.dispatchEvent(new Event("workspace:editor-settings-changed"))
}

/** A missing global override retains each workspace's previously selected icon theme. */
export function loadEditorIconTheme(): IconTheme | null {
  const raw = localStorage.getItem("workspace:editor-icon-theme")
  if (raw === null) return null
  const value: unknown = JSON.parse(raw)
  if (!iconThemes.includes(value as IconTheme)) throw new Error("Invalid file icon theme")
  return value as IconTheme
}
export function saveEditorIconTheme(theme: IconTheme): void {
  if (!iconThemes.includes(theme)) throw new Error("Invalid file icon theme")
  localStorage.setItem("workspace:editor-icon-theme", JSON.stringify(theme))
  window.dispatchEvent(new Event("workspace:editor-settings-changed"))
}
export function subscribeEditorSettings(listener: () => void): () => void {
  const onStorage = (event: StorageEvent): void => {
    if (event.storageArea !== null && event.storageArea !== localStorage) return
    if (event.key === null || event.key === "workspace:editor-settings" || event.key === "workspace:editor-icon-theme")
      listener()
  }
  window.addEventListener("storage", onStorage)
  window.addEventListener("workspace:editor-settings-changed", listener)
  window.addEventListener("focus", listener)
  return () => {
    window.removeEventListener("storage", onStorage)
    window.removeEventListener("workspace:editor-settings-changed", listener)
    window.removeEventListener("focus", listener)
  }
}
