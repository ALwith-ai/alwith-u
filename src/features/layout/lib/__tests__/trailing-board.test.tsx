import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

import { TrailingBoard } from "../../components/trailing-board"

const open = vi.hoisted(() => vi.fn(() => Promise.resolve()))
vi.mock("@/lib/chat-window", () => ({ openChatWindow: vi.fn() }))
vi.mock("@/features/vibemon/transport", () => ({ requestPet: vi.fn() }))
vi.mock("@/bindings", () => ({ commands: { openAppById: open } }))
vi.mock("@/features/auth/store", () => ({ usePlatformAuth: () => null }))
vi.mock("@/features/vibemon/main-host", () => ({ initializeVibemonMain: vi.fn() }))
vi.mock("@/features/vibemon/use-lounge-drop", () => ({ useLoungeDrop: () => false }))
vi.mock("../use-running-apps", () => ({
  useRunningApps: () => [{ name: "Google Chrome", bundle_id: "com.google.Chrome", icon: null }]
}))
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }))
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }))
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: { getAll: () => Promise.resolve([]) },
  getCurrentWebviewWindow: () => ({ onFocusChanged: () => Promise.resolve(() => {}) })
}))
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

test("Chrome is a plain application card that activates the native app without bridge controls", async () => {
  render(<TrailingBoard onOpenVibemon={() => {}} />)
  fireEvent.click(screen.getByRole("button", { name: "Google Chrome" }))
  await waitFor(() => expect(open).toHaveBeenCalledWith({ bundleId: "com.google.Chrome" }))
  expect(screen.queryByRole("switch")).not.toBeInTheDocument()
  expect(screen.queryByText(/bridge|扩展|桥/i)).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "actions.close" })).not.toBeInTheDocument()
})
