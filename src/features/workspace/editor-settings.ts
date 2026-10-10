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
}
