import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
const mocks = vi.hoisted(() => ({ settings: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }))
vi.mock("@/lib/window-manager", () => ({ openSettingsWindow: mocks.settings }))
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
import { ComputerControl } from "../computer-control"
beforeEach(() => {
  mocks.settings.mockResolvedValue(undefined)
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
test("floating entry opens application settings without requesting a conversation grant", () => {
  render(<ComputerControl />)
  fireEvent.click(screen.getByRole("button"))
  expect(mocks.settings).toHaveBeenCalledExactlyOnceWith("computer")
})
