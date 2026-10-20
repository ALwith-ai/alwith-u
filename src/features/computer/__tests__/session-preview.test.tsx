import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import type { ComputerPreview } from "@/bindings"
const native = vi.hoisted(() => ({
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  listen: vi.fn(),
  cancel: vi.fn(),
  focus: vi.fn(),
  unlisten: vi.fn()
}))
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }))
vi.mock("@/bindings", () => ({
  commands: {
    computerFocus: native.focus,
    computerSubscribe: native.subscribe,
    computerUnsubscribe: native.unsubscribe
  },
  events: { "computer:preview": { listen: native.listen } }
}))
vi.mock("@/lib/client", () => ({ client: { cancel: native.cancel } }))
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
import { SessionPreview } from "../session-preview"
beforeEach(() => {
  vi.resetAllMocks()
  native.subscribe.mockResolvedValue(undefined)
  native.unsubscribe.mockResolvedValue(undefined)
  native.listen.mockResolvedValue(native.unlisten)
  native.cancel.mockResolvedValue(undefined)
})
afterEach(cleanup)
async function emit(sessionId: string, phase: string, subscriptionId?: string) {
  await waitFor(() => expect(native.subscribe).toHaveBeenCalled())
  const payload: ComputerPreview = {
    subscriptionId: subscriptionId ?? native.subscribe.mock.calls.at(-1)?.[0].subscriptionId,
    activity: {
      sessionId,
      phase,
      queuePosition: phase === "queued" ? 1 : 0,
      ownerSessionId: "a",
      action: "click",
      target: { pid: 1, windowId: 2 },
      revision: 1
    },
    frame:
      phase === "active"
        ? { title: "Document", appName: "TextEdit", image: "data:image/jpeg;base64,AAAA", cursor: null }
        : null,
    error: null
  }
  act(() => native.listen.mock.calls.at(-1)?.[0]({ payload }))
}
test("only matching subscription and conversation may display live frames", async () => {
  const view = render(<SessionPreview sessionId="a" />)
  await emit("b", "active")
  expect(screen.queryByRole("img")).not.toBeInTheDocument()
  await emit("a", "active", "stale-subscription")
  expect(screen.queryByRole("img")).not.toBeInTheDocument()
  await emit("a", "active")
  expect(screen.getByText("TextEdit")).toBeInTheDocument()
  expect(screen.getByRole("img")).toBeInTheDocument()
  await emit("a", "idle")
  expect(screen.queryByRole("img")).not.toBeInTheDocument()
  const subscriptionId = native.subscribe.mock.calls[0]?.[0].subscriptionId
  view.unmount()
  expect(native.unlisten).toHaveBeenCalled()
  expect(native.unsubscribe).toHaveBeenCalledWith({ subscriptionId })
})
test("queued panel cancels its own session without stopping global authority", async () => {
  render(<SessionPreview sessionId="b" />)
  await emit("b", "queued")
  expect(screen.queryByRole("img")).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "computer.preview.cancelQueue" }))
  await waitFor(() => expect(native.cancel).toHaveBeenCalledExactlyOnceWith("b"))
})

test("preview supports collapse, expansion and stopping from the enlarged view", async () => {
  render(<SessionPreview sessionId="a" />)
  await emit("a", "active")
  fireEvent.click(screen.getByRole("button", { name: "computer.preview.collapse" }))
  expect(screen.queryByRole("img")).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "computer.preview.expand" }))
  expect(screen.getByRole("img")).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "computer.preview.enlarge" }))
  expect(screen.getByRole("dialog")).toBeInTheDocument()
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "computer.preview.stop" }))
  await waitFor(() => expect(native.cancel).toHaveBeenCalledExactlyOnceWith("a"))
})

test("clicking the preview focuses its own session and observed revision", async () => {
  render(<SessionPreview sessionId="a" />)
  await emit("a", "active")
  fireEvent.click(screen.getByRole("button", { name: "computer.preview.focus" }))
  await waitFor(() => expect(native.focus).toHaveBeenCalledExactlyOnceWith({ sessionId: "a", revision: 1 }))
})
