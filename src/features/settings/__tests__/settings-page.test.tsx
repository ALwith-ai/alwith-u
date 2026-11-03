import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeAll, expect, test, vi } from "vitest"

import { initI18n } from "@/lib/i18n"

vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }))
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    onCloseRequested: () => Promise.resolve(() => {}),
    hide: () => {
      return Promise.resolve()
    }
  })
}))
vi.mock("@/features/mobile/mobile-section", () => ({ MobileSection: () => null }))
vi.mock("@/features/drive/drive", () => ({ DriveSettings: () => null }))
vi.mock("@/features/drive/use-drive-visible", () => ({ useDriveVisible: () => true }))
vi.mock("@/features/extensions/runtime", () => ({ reportExtensionError: vi.fn() }))
vi.mock("@/features/extensions/use-extensions", () => ({
  useExtensions: () => ({ host: { views: [] }, state: { native: null } })
}))
vi.mock("@/features/extensions/extensions-section", () => ({ ExtensionsSection: () => null }))
vi.mock("@/features/workspace/editor-settings-dialog", () => ({ EditorSettingsSection: () => null }))
vi.mock("../sections/general-section", () => ({ GeneralSection: () => null }))
vi.mock("../sections/appearance-section", () => ({ AppearanceSection: () => null }))
vi.mock("../sections/account-section", () => ({ AccountSection: () => null }))
vi.mock("../sections/provider-section", () => ({ ProviderSection: () => null }))
vi.mock("../sections/voice-section", () => ({ VoiceSection: () => null }))
vi.mock("../sections/image-section", () => ({
  ImageSection: ({ onOpenModels }: { onOpenModels: () => void }) => (
    <button onClick={onOpenModels}>Manage image account</button>
  )
}))
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

test("mobile connections open from the account menu, not settings navigation", () => {
  window.history.replaceState(null, "", "/settings.html?tab=mobile")
  try {
    render(<SettingsPage />)
    expect(screen.queryByRole("button", { name: "Mobile connection" })).toBeNull()
    expect(screen.getByRole("region", { name: "Mobile connection" })).toBeVisible()
  } finally {
    window.history.replaceState(null, "", "/")
  }
})

test("explorer settings expose the global hidden-file switch", () => {
  render(<SettingsPage />)
  fireEvent.click(screen.getByRole("button", { name: "Explorer" }))
  expect(screen.getByRole("region", { name: "Explorer" })).toBeVisible()
  expect(screen.getByRole("switch", { name: "Show hidden files" })).toBeVisible()
})

test("image settings have a permanent section and account management returns to Models", () => {
  window.history.replaceState(null, "", "/settings.html?tab=images")
  try {
    render(<SettingsPage />)
    expect(screen.getByRole("region", { name: "Images" })).toBeVisible()
    expect(screen.getByRole("button", { name: "Images" })).toHaveAttribute("aria-current", "page")
    fireEvent.click(screen.getByRole("button", { name: "Manage image account" }))
    expect(screen.getByRole("region", { name: "Models" })).toBeVisible()
    expect(screen.getByRole("button", { name: "Images" })).not.toHaveAttribute("aria-current")
  } finally {
    window.history.replaceState(null, "", "/")
  }
})
