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

test("editor settings subscribers update in the current window and other windows", async () => {
  const { subscribeEditorSettings } = await import("../editor-settings")
  let notifications = 0
  const stop = subscribeEditorSettings(() => {
    notifications++
  })
  saveEditorSettings({ ...defaultEditorSettings, fontSize: 20 })
  expect(notifications).toBe(1)
  window.dispatchEvent(new StorageEvent("storage", { key: "workspace:editor-settings" }))
  expect(notifications).toBe(2)
  window.dispatchEvent(new StorageEvent("storage", { key: "unrelated" }))
  expect(notifications).toBe(2)
  stop()
  saveEditorSettings(defaultEditorSettings)
  expect(notifications).toBe(2)
})

test("global file icon preference is optional so existing workspace themes remain intact", async () => {
  const { loadEditorIconTheme, saveEditorIconTheme } = await import("../editor-settings")
  expect(loadEditorIconTheme()).toBeNull()
  saveEditorIconTheme("catppuccin-mocha")
  expect(loadEditorIconTheme()).toBe("catppuccin-mocha")
  localStorage.setItem("workspace:editor-icon-theme", JSON.stringify("unknown"))
  expect(() => loadEditorIconTheme()).toThrow("Invalid file icon theme")
})
