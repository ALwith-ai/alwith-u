import { isTauri } from "@tauri-apps/api/core"
import { writeText } from "@tauri-apps/plugin-clipboard-manager"
import { afterEach, expect, test, vi } from "vitest"

import { copyText } from "../clipboard"

vi.mock("@tauri-apps/api/core", () => ({ isTauri: vi.fn() }))
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }))
afterEach(() => {
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

test("desktop copy uses the native clipboard and propagates failure", async () => {
  vi.mocked(isTauri).mockReturnValue(true)
  const browser = vi.fn()
  vi.stubGlobal("navigator", { clipboard: { writeText: browser } })
  vi.mocked(writeText).mockResolvedValueOnce(undefined)
  await copyText("Exact message")
  expect(writeText).toHaveBeenCalledWith("Exact message")
  expect(browser).not.toHaveBeenCalled()
  const failure = new Error("Clipboard unavailable")
  vi.mocked(writeText).mockRejectedValueOnce(failure)
  await expect(copyText("Code")).rejects.toBe(failure)
})

test("browser previews use the browser clipboard", async () => {
  vi.mocked(isTauri).mockReturnValue(false)
  const browser = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal("navigator", { clipboard: { writeText: browser } })
  await copyText("Preview")
  expect(browser).toHaveBeenCalledWith("Preview")
  expect(writeText).not.toHaveBeenCalled()
})
