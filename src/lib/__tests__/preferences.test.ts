import { LazyStore } from "@tauri-apps/plugin-store"
import { expect, test, vi } from "vitest"
import { loadPreferences } from "../preferences"

test.each([undefined, { main: "gateway:deepseek:deepseek-flash", chat: "gpt-6-astra" }])(
  "restores per-slot selections %p without borrowing legacy global or historical choices",
  async saved => {
    const get = vi
      .spyOn(LazyStore.prototype, "get")
      .mockImplementation(
        async <T>(key: string): Promise<T | undefined> =>
          (key === "modelSelections" ? saved : key === "lastModel" ? "legacy-global" : undefined) as T | undefined
      )
    try {
      expect((await loadPreferences()).modelSelections).toEqual(saved ?? { main: null, chat: null })
    } finally {
      get.mockRestore()
    }
  }
)

test.each([undefined, false, true])(
  "sidebar pin preference restores %p, with missing values defaulting to off",
  async saved => {
    const get = vi
      .spyOn(LazyStore.prototype, "get")
      .mockImplementation(
        async <T>(key: string): Promise<T | undefined> => (key === "sidebarPinned" ? saved : undefined) as T | undefined
      )
    try {
      expect((await loadPreferences()).sidebarPinned).toBe(saved ?? false)
      expect(get).toHaveBeenCalledWith("sidebarPinned")
    } finally {
      get.mockRestore()
    }
  }
)
