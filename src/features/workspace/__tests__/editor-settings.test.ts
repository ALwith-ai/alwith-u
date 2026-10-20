import { afterEach, beforeEach, expect, test, vi } from "vitest"

import { settingsFixture } from "@/lib/__tests__/settings-fixture"

import {
  defaultEditorSettings,
  loadEditorIconTheme,
  loadEditorSettings,
  saveEditorIconTheme,
  saveEditorSettings,
  subscribeEditorSettings
} from "../editor-settings"
let fixture: ReturnType<typeof settingsFixture>
beforeEach(() => {
  fixture = settingsFixture()
})
afterEach(() => vi.restoreAllMocks())
test("editor preferences persist and retain defaults for first use", async () => {
  expect(loadEditorSettings()).toEqual(defaultEditorSettings)
  const settings = { ...defaultEditorSettings, fontSize: 18, fontFamily: "Menlo", minimap: true, wordWrap: false }
  await saveEditorSettings(settings)
  expect(loadEditorSettings()).toEqual(settings)
  expect(fixture.values.get("editor.fontSize")).toBe(18)
})
test("rejects invalid editor preferences at the storage boundary", async () => {
  await expect(saveEditorSettings({ fontSize: -1 })).rejects.toThrow("Invalid editor settings")
  expect(loadEditorSettings()).toEqual(defaultEditorSettings)
})
test("subscribers follow committed local and other-window updates only", async () => {
  let notifications = 0
  const stop = subscribeEditorSettings(() => {
    notifications++
  })
  await saveEditorSettings({ fontSize: 20 })
  expect(notifications).toBe(1)
  fixture.changed({ "editor.fontSize": 22 })
  expect(notifications).toBe(2)
  fixture.changed({ "voice.enabled": false })
  expect(notifications).toBe(2)
  stop()
  await saveEditorSettings(defaultEditorSettings)
  expect(notifications).toBe(2)
})
test("global icon theme remains optional and validates user input", async () => {
  expect(loadEditorIconTheme()).toBeNull()
  await saveEditorIconTheme("catppuccin-mocha")
  expect(loadEditorIconTheme()).toBe("catppuccin-mocha")
  fixture.changed({ "editor.iconTheme": "unknown" })
  expect(() => loadEditorIconTheme()).toThrow("Invalid file icon theme")
})
test("independent edits preserve both fields and failed saves preserve the visible value", async () => {
  await Promise.all([saveEditorSettings({ fontSize: 20 }), saveEditorSettings({ wordWrap: false })])
  expect(loadEditorSettings()).toMatchObject({ fontSize: 20, wordWrap: false })
  fixture.write.mockRejectedValueOnce(new Error("Disk full"))
  await expect(saveEditorSettings({ fontSize: 24 })).rejects.toThrow("Disk full")
  expect(loadEditorSettings().fontSize).toBe(20)
})
