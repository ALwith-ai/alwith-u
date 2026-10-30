import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import type { ComputerPreview_Serialize } from "@/bindings"
const native = vi.hoisted(() => ({
  subscribe: vi.fn<(request: { subscriptionId: string }) => Promise<unknown>>(),
  unsubscribe: vi.fn(),
  listen: vi.fn<(handler: (event: { payload: unknown }) => void) => Promise<() => void>>(),
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
  const subscription = native.subscribe.mock.lastCall
  if (subscription === undefined) throw new Error("The preview never subscribed")
  const payload: ComputerPreview_Serialize = {
    subscriptionId: subscriptionId ?? subscription[0].subscriptionId,
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
  void act(() => native.listen.mock.calls.at(-1)?.[0]({ payload }))
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

test("the preview header drags within its viewport and leaves toolbar buttons clickable", async () => {
  const view = render(
    <div>
      <div>
        <SessionPreview sessionId="a" />
      </div>
    </div>
  )
  await emit("a", "active")
  const card = screen.getByRole("region", { name: "computer.preview.title" })
  const header = screen.getByText("TextEdit").parentElement!
  vi.spyOn(card, "getBoundingClientRect").mockReturnValue(new DOMRect(704, 8, 288, 180))
  vi.spyOn(card.parentElement!.parentElement!, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1000, 700))
  header.setPointerCapture = vi.fn()
  const pointer = (type: string, x: number, y: number) => {
    const event = new Event(type, { bubbles: true })
    Object.assign(event, { pointerId: 1, button: 0, clientX: x, clientY: y })
    fireEvent(header, event)
  }
  pointer("pointerdown", 750, 20)
  pointer("pointermove", 650, 120)
  expect(card).toHaveStyle({ transform: "translate(-100px, 100px)" })
  pointer("pointermove", 2000, -100)
  expect(card).toHaveStyle({ transform: "translate(0px, 0px)" })
  pointer("pointerup", 2000, -100)
  fireEvent.click(screen.getByRole("button", { name: "computer.preview.collapse" }))
  expect(screen.queryByRole("img")).not.toBeInTheDocument()
  view.unmount()
})
