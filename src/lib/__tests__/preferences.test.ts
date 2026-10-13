import { clearMocks, mockIPC } from "@tauri-apps/api/mocks"
import { LazyStore } from "@tauri-apps/plugin-store"
import { afterEach, expect, test, vi } from "vitest"
import { loadPreferences } from "../preferences"

afterEach(() => {
  vi.restoreAllMocks()
  clearMocks()
})

function savedProject(directory: string | undefined): Map<string, unknown> {
  const values = new Map<string, unknown>()
  if (directory !== undefined) values.set("lastProjectDirectory", directory)
  values.set("language", "zh-CN")
  vi.spyOn(LazyStore.prototype, "get").mockImplementation(
    async <T>(key: string): Promise<T | undefined> => values.get(key) as T | undefined
  )
  vi.spyOn(LazyStore.prototype, "delete").mockImplementation(async key => values.delete(key))
  vi.spyOn(LazyStore.prototype, "save").mockResolvedValue()
  return values
}

test("startup clears an unavailable remembered project and selects the default workspace", async () => {
  const directory = "/private/tmp/removed-project"
  const values = savedProject(directory)
  mockIPC(() => {
    throw `Project directory is unavailable: ${directory}`
  })
  const preferences = await loadPreferences()
  expect(preferences.lastProjectDirectory).toBeNull()
  expect(preferences.language).toBe("zh-CN")
  expect(values.has("lastProjectDirectory")).toBe(false)
  expect(LazyStore.prototype.save).toHaveBeenCalledOnce()
  expect((await loadPreferences()).lastProjectDirectory).toBeNull()
})

test("startup validates and preserves an available remembered project", async () => {
  const directory = "/Users/finture/projects/alwith/alwith-u"
  const values = savedProject(directory)
  const calls: string[] = []
  mockIPC((command, args) => {
    expect(command).toBe("draft_directory")
    expect(args).toEqual({ cwd: directory })
    calls.push(command)
    return directory
  })
  expect((await loadPreferences()).lastProjectDirectory).toBe(directory)
  expect(calls).toEqual(["draft_directory"])
  expect(values.get("lastProjectDirectory")).toBe(directory)
  expect(LazyStore.prototype.save).not.toHaveBeenCalled()
})

test("startup without a remembered project uses the existing default workspace flow", async () => {
  savedProject(undefined)
  mockIPC(() => {
    throw new Error("No directory validation is needed")
  })
  expect((await loadPreferences()).lastProjectDirectory).toBeNull()
  expect(LazyStore.prototype.save).not.toHaveBeenCalled()
})

test("startup preserves the remembered project when the native bridge fails", async () => {
  const directory = "/tmp/project"
  const values = savedProject(directory)
  mockIPC(() => {
    throw "Native bridge unavailable"
  })
  await expect(loadPreferences()).rejects.toBe("Native bridge unavailable")
  expect(values.get("lastProjectDirectory")).toBe(directory)
  expect(LazyStore.prototype.save).not.toHaveBeenCalled()
})

test("startup reports failures to persist the cleared project", async () => {
  const directory = "/tmp/removed-project"
  savedProject(directory)
  vi.mocked(LazyStore.prototype.save).mockRejectedValue(new Error("Store write failed"))
  mockIPC(() => {
    throw `Project directory is unavailable: ${directory}`
  })
  await expect(loadPreferences()).rejects.toThrow("Store write failed")
})

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
