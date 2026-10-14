import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart"
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { toast } from "sonner"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { initI18n } from "@/lib/i18n"
import { AutostartRow } from "../autostart-row"

vi.mock("@tauri-apps/plugin-autostart", () => ({ enable: vi.fn(), disable: vi.fn(), isEnabled: vi.fn() }))
beforeEach(async () => {
  vi.resetAllMocks()
  await initI18n("en")
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

test("the switch reads system state, serializes changes and refreshes after external changes", async () => {
  vi.mocked(isEnabled).mockResolvedValue(false)
  const pending = Promise.withResolvers<void>()
  vi.mocked(enable).mockImplementation(() => pending.promise)
  const view = render(<AutostartRow />)
  const toggle = view.getByRole("switch", { name: "Start Vibémon at login" })
  await waitFor(() => expect(toggle).not.toHaveAttribute("aria-disabled", "true"))
  fireEvent.click(toggle)
  expect(toggle).toHaveAttribute("aria-disabled", "true")
  fireEvent.click(toggle)
  expect(enable).toHaveBeenCalledOnce()
  vi.mocked(isEnabled).mockResolvedValue(true)
  await act(async () => pending.resolve())
  await waitFor(() => expect(toggle).toBeChecked())
  expect(disable).not.toHaveBeenCalled()
  vi.mocked(isEnabled).mockResolvedValue(false)
  await act(async () => fireEvent.focus(window))
  await waitFor(() => expect(toggle).not.toBeChecked())
})

test("native failures are visible and focus retries the authoritative state", async () => {
  const error = vi.spyOn(toast, "error").mockImplementation(() => "error")
  vi.mocked(isEnabled).mockRejectedValue(new Error("Login items unavailable"))
  const view = render(<AutostartRow />)
  await waitFor(() => expect(error).toHaveBeenCalledWith("Login items unavailable"))
  expect(view.getByRole("switch")).toHaveAttribute("aria-disabled", "true")
  vi.mocked(isEnabled).mockResolvedValue(true)
  await act(async () => fireEvent.focus(window))
  await waitFor(() => expect(view.getByRole("switch")).not.toHaveAttribute("aria-disabled", "true"))
  vi.mocked(isEnabled).mockResolvedValue(false)
  await act(async () => fireEvent.click(view.getByRole("switch")))
  expect(disable).toHaveBeenCalledOnce()
  expect(view.getByRole("switch")).not.toBeChecked()
})
