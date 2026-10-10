import { beforeEach, expect, test } from "vitest"
import { defaultEditorSettings, loadEditorSettings, saveEditorSettings } from "../editor-settings"

beforeEach(() => localStorage.clear())
test("editor preferences survive reload and retain defaults for first use", () => {
  expect(loadEditorSettings()).toEqual(defaultEditorSettings)
  const settings = { ...defaultEditorSettings, fontSize: 18, fontFamily: "Menlo", minimap: true, wordWrap: false }
  saveEditorSettings(settings)
  expect(loadEditorSettings()).toEqual(settings)
})
test("rejects invalid editor preferences at the storage boundary", () => {
  localStorage.setItem("workspace:editor-settings", JSON.stringify({ fontSize: -1 }))
  expect(() => loadEditorSettings()).toThrow("Invalid editor settings")
})
