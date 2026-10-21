import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import { requestChatSurface } from "@/lib/chat-window"
import { initI18n } from "@/lib/i18n"

import { ChatWindowPetButton } from "../chat-window-pet-button"
import { collapseChatToPet } from "../window-client"

vi.mock("../window-client", () => ({ collapseChatToPet: vi.fn() }))
vi.mock("@/lib/chat-window", () => ({ requestChatSurface: vi.fn() }))
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ onCloseRequested: () => Promise.resolve(() => {}) })
}))
beforeEach(async () => {
  vi.resetAllMocks()
  await initI18n("en")
})
afterEach(() => cleanup())

test.each(["equip", "pull"] as const)(
  "guidance opens the requested %s view without transferring the conversation",
  async (target) => {
    vi.mocked(collapseChatToPet).mockResolvedValue({ type: "setup", view: target })
    const view = render(<ChatWindowPetButton sessionId="original-session" />)
    await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "Collapse" }))))
    expect(view.getByRole("dialog")).toBeVisible()
    const buttons = view.getByRole("dialog").querySelectorAll("button")
    const action = [...buttons].find((button) => /Go to (equip|draw)/i.test(button.textContent ?? ""))
    if (!action) throw new Error("Missing equipment guidance action")
    await act(() => Promise.try(() => fireEvent.click(action)))
    expect(requestChatSurface).toHaveBeenCalledWith("main", { type: "vibemon", view: target })
    expect(collapseChatToPet).toHaveBeenCalledWith("original-session", expect.any(AbortSignal))
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull())
  }
)

test("repeated clicks issue one collapse and a new session cannot receive the previous result", async () => {
  const pending = Promise.withResolvers<Awaited<ReturnType<typeof collapseChatToPet>>>()
  vi.mocked(collapseChatToPet).mockReturnValue(pending.promise)
  const view = render(<ChatWindowPetButton sessionId="first" />)
  fireEvent.click(view.getByRole("button", { name: "Collapse" }))
  fireEvent.click(view.getByRole("button", { name: "Collapse" }))
  expect(collapseChatToPet).toHaveBeenCalledOnce()
  const signal = vi.mocked(collapseChatToPet).mock.calls[0]?.[1]
  view.rerender(<ChatWindowPetButton sessionId="second" />)
  expect(signal?.aborted).toBe(true)
  await act(() => Promise.try(() => pending.resolve({ type: "setup", view: "equip" })))
  expect(view.queryByRole("dialog")).toBeNull()
  expect(view.getByRole("button", { name: "Collapse" })).toBeEnabled()
})

test("network errors remain visible instead of incorrectly offering equipment", async () => {
  vi.mocked(collapseChatToPet).mockRejectedValue(new Error("Asset service unavailable"))
  const view = render(<ChatWindowPetButton sessionId="session" />)
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "Collapse" }))))
  await waitFor(() => expect(view.getByText("Asset service unavailable")).toBeVisible())
  expect(requestChatSurface).not.toHaveBeenCalled()
})

test("a failed equipment navigation keeps guidance available for retry", async () => {
  vi.mocked(collapseChatToPet).mockResolvedValue({ type: "setup", view: "equip" })
  vi.mocked(requestChatSurface).mockRejectedValueOnce(new Error("Main window unavailable"))
  const view = render(<ChatWindowPetButton sessionId="session" />)
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "Collapse" }))))
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "Go to equip" }))))
  expect(view.getByRole("alert")).toHaveTextContent("Main window unavailable")
  expect(view.getByRole("button", { name: "Go to equip" })).toBeEnabled()
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "Go to equip" }))))
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull())
})
