import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, expect, test, vi } from "vitest"

const controls = vi.hoisted(() => ({ export: vi.fn(), status: vi.fn(), success: vi.fn(), error: vi.fn() }))
vi.mock("@alwith/module-computer/commands", () => ({ commands: { status: controls.status } }))
vi.mock("@/bindings", () => ({ commands: { diagnosticsExport: controls.export } }))
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }))
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock("sonner", () => ({ toast: { success: controls.success, error: controls.error } }))
vi.mock("@alwith/module-desktop-shell/react", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useDesktopUpdater: () => ({ state: { type: "idle" }, confirmInstallAndRelaunch: vi.fn() })
}))

import { AboutSection } from "../sections/about-section"

beforeEach(() => {
  vi.clearAllMocks()
  controls.status.mockResolvedValue({ diagnostics: "driver and gateway logs" })
})

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
  await waitFor(() =>
    expect(controls.export).toHaveBeenCalledExactlyOnceWith({ computerDiagnostics: "driver and gateway logs" })
  )
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
