import { expect, spyOn, test } from "bun:test"
import { LazyStore } from "@tauri-apps/plugin-store"
import { loadPreferences } from "../preferences"

test.each([undefined, false, true])(
  "sidebar pin preference restores %p, with missing values defaulting to off",
  async saved => {
    const get = spyOn(LazyStore.prototype, "get").mockImplementation(
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
