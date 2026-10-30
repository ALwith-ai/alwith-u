import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, expect, test, vi } from "vitest"

const controls = vi.hoisted(() => ({ export: vi.fn(), success: vi.fn(), error: vi.fn() }))
vi.mock("@/bindings", () => ({ commands: { diagnosticsExport: controls.export } }))
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }))
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock("sonner", () => ({ toast: { success: controls.success, error: controls.error } }))
vi.mock("@/features/updater/store", () => ({
  useUpdaterStore: (selector: (state: unknown) => unknown) => selector({ state: { type: "idle" } })
}))

import { AboutSection } from "../sections/about-section"

beforeEach(() => vi.clearAllMocks())

test("export keeps the button busy until the native save completes", async () => {
  let finish!: (saved: boolean) => void
  controls.export.mockReturnValue(
    new Promise<boolean>((resolve) => {
      finish = resolve
    })
  )
  render(<AboutSection />)
  fireEvent.click(screen.getByRole("button", { name: "settings.diagnosticsExport" }))
  expect(screen.getByRole("button", { name: "settings.diagnosticsExporting" })).toBeDisabled()
  expect(controls.export).toHaveBeenCalledTimes(1)
  finish(true)
  await waitFor(() => expect(controls.success).toHaveBeenCalledWith("settings.diagnosticsExported"))
  expect(screen.getByRole("button", { name: "settings.diagnosticsExport" })).toBeEnabled()
})

test("canceling the save dialog does not report a successful export", async () => {
  controls.export.mockResolvedValue(false)
  render(<AboutSection />)
  fireEvent.click(screen.getByRole("button", { name: "settings.diagnosticsExport" }))
  await waitFor(() => expect(screen.getByRole("button", { name: "settings.diagnosticsExport" })).toBeEnabled())
  expect(controls.success).not.toHaveBeenCalled()
  expect(controls.error).not.toHaveBeenCalled()
})

test("native export failures are shown and the user can retry", async () => {
  controls.export.mockRejectedValue(new Error("Disk is full"))
  render(<AboutSection />)
  fireEvent.click(screen.getByRole("button", { name: "settings.diagnosticsExport" }))
  await waitFor(() => expect(controls.error).toHaveBeenCalledWith("Disk is full"))
  expect(screen.getByRole("button", { name: "settings.diagnosticsExport" })).toBeEnabled()
})
