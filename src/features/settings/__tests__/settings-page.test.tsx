import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeAll, expect, test, vi } from "vitest"

import { initI18n } from "@/lib/i18n"

vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }))
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ onCloseRequested: async () => () => {}, hide: async () => {} })
}))
vi.mock("@/features/drive/drive", () => ({ DriveSettings: () => null }))
vi.mock("@/features/drive/use-drive-visible", () => ({ useDriveVisible: () => true }))
vi.mock("@/features/extensions/runtime", () => ({
  useExtensions: () => ({ host: { views: [] }, state: { native: null } })
}))
vi.mock("@/features/extensions/extensions-section", () => ({ ExtensionsSection: () => null }))
vi.mock("@/features/workspace/editor-settings-dialog", () => ({ EditorSettingsSection: () => null }))
vi.mock("../sections/general-section", () => ({ GeneralSection: () => null }))
vi.mock("../sections/appearance-section", () => ({ AppearanceSection: () => null }))
vi.mock("../sections/account-section", () => ({ AccountSection: () => null }))
vi.mock("../sections/provider-section", () => ({ ProviderSection: () => null }))
vi.mock("../sections/voice-section", () => ({ VoiceSection: () => null }))
vi.mock("../sections/computer-section", () => ({ ComputerSection: () => null }))
vi.mock("../sections/about-section", () => ({ AboutSection: () => null }))

import { SettingsPage } from "../settings-page"

beforeAll(() => initI18n("en"))
afterEach(cleanup)

test("settings has no visible window or sidebar title and keeps navigation accessible", () => {
  render(<SettingsPage />)
  expect(screen.queryByText("Settings")).not.toBeInTheDocument()
  expect(screen.getAllByText("General")).toHaveLength(1)
  expect(screen.getByRole("navigation", { name: "Settings" })).toBeVisible()
  expect(screen.getByRole("region", { name: "General" })).toBeVisible()
})

test("changing settings sections updates the accessible content label and current navigation item", () => {
  render(<SettingsPage />)
  fireEvent.click(screen.getByRole("button", { name: "Appearance" }))
  expect(screen.getByRole("region", { name: "Appearance" })).toBeVisible()
  expect(screen.getByRole("button", { name: "Appearance" })).toHaveAttribute("aria-current", "page")
  expect(screen.getByRole("button", { name: "General" })).not.toHaveAttribute("aria-current")
  expect(screen.getAllByText("Appearance")).toHaveLength(1)
})
