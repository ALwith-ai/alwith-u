import { clearMocks, mockIPC } from "@tauri-apps/api/mocks"
import { afterEach, expect, test, vi } from "vitest"

import { mockOf } from "@/test/mock-of"

import { loadPreferences } from "../preferences"
import { settingsStore } from "../settings-store"
import { settingsFixture } from "./settings-fixture"

/** Native and transport layers reject with plain values; tests reproduce that exactly. */
const nonError = (value: unknown): unknown => value

afterEach(() => {
  vi.restoreAllMocks()
  clearMocks()
})

function savedProject(directory: string | undefined): Map<string, unknown> {
  return settingsFixture({
    "general.language": "zh-CN",
    ...(directory === undefined ? {} : { "general.lastProjectDirectory": directory })
  }).values
}

test("startup clears an unavailable remembered project and selects the default workspace", async () => {
  const directory = "/private/tmp/removed-project"
  const values = savedProject(directory)
  mockIPC(() => {
    throw nonError(`Project directory is unavailable: ${directory}`)
  })
  const preferences = await loadPreferences()
  expect(preferences.lastProjectDirectory).toBeNull()
  expect(preferences.language).toBe("zh-CN")
  expect(values.has("general.lastProjectDirectory")).toBe(false)
  expect(mockOf(settingsStore, "write")).toHaveBeenCalledOnce()
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
  expect(values.get("general.lastProjectDirectory")).toBe(directory)
  expect(mockOf(settingsStore, "write")).not.toHaveBeenCalled()
})

test("startup without a remembered project uses the existing default workspace flow", async () => {
  savedProject(undefined)
  mockIPC(() => {
    throw new Error("No directory validation is needed")
  })
  expect((await loadPreferences()).lastProjectDirectory).toBeNull()
  expect(mockOf(settingsStore, "write")).not.toHaveBeenCalled()
})

test("startup preserves the remembered project when the native bridge fails", async () => {
  const directory = "/tmp/project"
  const values = savedProject(directory)
  mockIPC(() => {
    throw nonError("Native bridge unavailable")
  })
  await expect(loadPreferences()).rejects.toBe("Native bridge unavailable")
  expect(values.get("general.lastProjectDirectory")).toBe(directory)
  expect(mockOf(settingsStore, "write")).not.toHaveBeenCalled()
})

test("startup reports failures to persist the cleared project", async () => {
  const directory = "/tmp/removed-project"
  savedProject(directory)
  mockOf(settingsStore, "write").mockRejectedValue(new Error("Store write failed"))
  mockIPC(() => {
    throw nonError(`Project directory is unavailable: ${directory}`)
  })
  await expect(loadPreferences()).rejects.toThrow("Store write failed")
})

test.each([undefined, { main: "gateway:deepseek:deepseek-flash", chat: "gpt-6-astra" }])(
  "restores per-slot selections %p",
  async (saved) => {
    settingsFixture(saved === undefined ? {} : { "chat.modelSelections": saved })
    expect((await loadPreferences()).modelSelections).toEqual(saved ?? { main: null, chat: null })
  }
)
test.each([undefined, false, true])("sidebar pin preference restores %p", async (saved) => {
  settingsFixture(saved === undefined ? {} : { "appearance.sidebarPinned": saved })
  expect((await loadPreferences()).sidebarPinned).toBe(saved ?? false)
})

test("input suggestions default to enabled and preserve an explicit saved choice", async () => {
  const values = savedProject(undefined)
  expect((await loadPreferences()).composerPredictions).toBe(true)
  values.set("chat.composerPredictions", false)
  expect((await loadPreferences()).composerPredictions).toBe(false)
  values.set("chat.composerPredictions", true)
  expect((await loadPreferences()).composerPredictions).toBe(true)
})
