import { createSession } from "@alwith/module-chat/client"
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

const host = vi.hoisted(() => ({ getByLabel: vi.fn(), open: vi.fn(), request: vi.fn() }))
vi.mock("@tauri-apps/api/webviewWindow", async (original) => ({
  ...(await original<object>()),
  WebviewWindow: { getByLabel: host.getByLabel }
}))
vi.mock("@/lib/chat-window", () => ({ openChatWindow: host.open, requestChatSurface: host.request }))

import { useChatWindowSurface } from "@/lib/chat-window-state"
import { client } from "@/lib/client"
import { initI18n } from "@/lib/i18n"

import { useSidebarChatWindow } from "../use-sidebar-chat-window"

await initI18n("en")
const initial = client.state
const session = createSession("floating-existing", "/tmp/floating")

function Harness() {
  const { open, confirmation } = useSidebarChatWindow()
  return (
    <>
      <button onClick={open}>Open floating chat</button>
      {confirmation}
    </>
  )
}

beforeEach(() => {
  host.getByLabel.mockResolvedValue({ isVisible: () => Promise.resolve(true) })
  host.open.mockResolvedValue(undefined)
  host.request.mockResolvedValue(null)
  client.store.setState({
    sessions: { [session.id]: session },
    sessionWindows: { [session.id]: "chat" },
    draftSessions: {}
  })
  useChatWindowSurface.setState({ sessionId: session.id, visible: true })
})

afterEach(() => {
  cleanup()
  client.store.setState(initial, true)
  useChatWindowSurface.setState({ sessionId: null, visible: false })
  vi.resetAllMocks()
})

test.each(["closed", "hidden", "draft"])("the sidebar directly opens a %s floating window", async (kind) => {
  if (kind === "closed") host.getByLabel.mockResolvedValue(null)
  if (kind === "hidden") host.getByLabel.mockResolvedValue({ isVisible: () => Promise.resolve(false) })
  if (kind === "draft") client.store.setState({ draftSessions: { [session.id]: "chat" } })
  const view = render(<Harness />)
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "Open floating chat" }))))
  expect(host.open).toHaveBeenCalledExactlyOnceWith()
  expect(host.request).not.toHaveBeenCalled()
  expect(view.queryByRole("alertdialog")).toBeNull()
  expect(client.state.sessions[session.id]).toBe(session)
})

test("an existing visible conversation switches to a new chat only after confirmation", async () => {
  const view = render(<Harness />)
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "Open floating chat" }))))
  expect(view.getByRole("alertdialog")).toHaveTextContent("Start a new chat in the current floating window?")
  expect(host.open).not.toHaveBeenCalled()
  expect(host.request).not.toHaveBeenCalled()
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "Confirm" }))))
  expect(host.request).toHaveBeenCalledExactlyOnceWith("chat", { type: "present", newChatFor: session.id })
  await waitFor(() => expect(view.queryByRole("alertdialog")).toBeNull())
})

test("cancelling leaves the current floating conversation untouched", async () => {
  const view = render(<Harness />)
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "Open floating chat" }))))
  fireEvent.click(view.getByRole("button", { name: "Cancel" }))
  await waitFor(() => expect(view.queryByRole("alertdialog")).toBeNull())
  expect(host.request).not.toHaveBeenCalled()
  expect(host.open).not.toHaveBeenCalled()
  expect(useChatWindowSurface.getState().sessionId).toBe(session.id)
})

test("confirmation stays bound to the conversation that was on screen when the sidebar was clicked", async () => {
  const view = render(<Harness />)
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "Open floating chat" }))))
  useChatWindowSurface.setState({ sessionId: "another-conversation" })
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "Confirm" }))))
  expect(host.request).toHaveBeenCalledExactlyOnceWith("chat", { type: "present", newChatFor: session.id })
})
