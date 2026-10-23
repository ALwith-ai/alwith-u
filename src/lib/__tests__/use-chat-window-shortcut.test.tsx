import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

import { SettingsClient, settingsStore } from "../settings-store"
import { useChatWindowShortcut } from "../use-chat-window-shortcut"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

test("shortcut hints follow saved settings and omit disabled accelerators", () => {
  const settings = new SettingsClient(() => Promise.reject(new Error("No native writes expected")))
  vi.spyOn(settingsStore, "get").mockImplementation((key) => settings.get(key))
  vi.spyOn(settingsStore, "subscribe").mockImplementation((listener) => settings.subscribe(listener))
  const { result } = renderHook(useChatWindowShortcut)
  expect(result.current).toBe("Alt+Space")
  act(() => settings.accept({ revision: 1, browserMigrated: true, values: { "chat.windowShortcut": "Ctrl+Shift+P" } }))
  expect(result.current).toBe("Ctrl+Shift+P")
  act(() => settings.accept({ revision: 2, browserMigrated: true, values: { "chat.windowShortcut": "" } }))
  expect(result.current).toBe("")
})
