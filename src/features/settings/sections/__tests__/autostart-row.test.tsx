import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { toast } from "sonner"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import { commands } from "@/bindings"
import { initI18n } from "@/lib/i18n"

import { AutostartRow } from "../autostart-row"

vi.mock("@/bindings", () => ({ commands: { autostartSet: vi.fn(), autostartStatus: vi.fn() } }))
beforeEach(async () => {
  vi.resetAllMocks()
  await initI18n("en")
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

test("development builds cannot register a login item", async () => {
  vi.mocked(commands.autostartStatus).mockResolvedValue({ enabled: false, supported: false })
  const view = render(<AutostartRow />)
  await waitFor(() => expect(view.getByText(/Available in the installed app/)).toBeInTheDocument())
  const toggle = view.getByRole("switch")
  expect(toggle).toHaveAttribute("aria-disabled", "true")
  fireEvent.click(toggle)
  expect(commands.autostartSet).not.toHaveBeenCalled()
})

test("the switch reads system state, serializes changes and refreshes after external changes", async () => {
  vi.mocked(commands.autostartStatus).mockResolvedValue({ enabled: false, supported: true })
  const pending = Promise.withResolvers<null>()
  vi.mocked(commands.autostartSet).mockImplementation(() => pending.promise)
  const view = render(<AutostartRow />)
  const toggle = view.getByRole("switch", { name: "Start Vibémon at login" })
  await waitFor(() => expect(toggle).not.toHaveAttribute("aria-disabled", "true"))
  fireEvent.click(toggle)
  expect(toggle).toHaveAttribute("aria-disabled", "true")
  fireEvent.click(toggle)
  expect(commands.autostartSet).toHaveBeenCalledOnce()
  vi.mocked(commands.autostartStatus).mockResolvedValue({ enabled: true, supported: true })
  await act(async () => pending.resolve(null))
  await waitFor(() => expect(toggle).toBeChecked())
  expect(commands.autostartSet).toHaveBeenCalledExactlyOnceWith({ enabled: true })
  vi.mocked(commands.autostartStatus).mockResolvedValue({ enabled: false, supported: true })
  await act(async () => fireEvent.focus(window))
  await waitFor(() => expect(toggle).not.toBeChecked())
})

test("native failures are visible and focus retries the authoritative state", async () => {
  const error = vi.spyOn(toast, "error").mockImplementation(() => "error")
  vi.mocked(commands.autostartStatus).mockRejectedValue(new Error("Login items unavailable"))
  const view = render(<AutostartRow />)
  await waitFor(() => expect(error).toHaveBeenCalledWith("Login items unavailable"))
  expect(view.getByRole("switch")).toHaveAttribute("aria-disabled", "true")
  vi.mocked(commands.autostartStatus).mockResolvedValue({ enabled: true, supported: true })
  await act(async () => fireEvent.focus(window))
  await waitFor(() => expect(view.getByRole("switch")).not.toHaveAttribute("aria-disabled", "true"))
  vi.mocked(commands.autostartStatus).mockResolvedValue({ enabled: false, supported: true })
  await act(async () => fireEvent.click(view.getByRole("switch")))
  expect(commands.autostartSet).toHaveBeenCalledExactlyOnceWith({ enabled: false })
  expect(view.getByRole("switch")).not.toBeChecked()
})
