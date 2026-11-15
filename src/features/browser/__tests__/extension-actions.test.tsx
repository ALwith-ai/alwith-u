import "./language"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, expect, test, vi } from "vitest"

import { badgeText, type ExtensionAction, ExtensionActions } from "../extension-actions"

const { invoke, listeners } = vi.hoisted(() => ({
  invoke: vi.fn(),
  listeners: new Map<string, (event: { payload: unknown }) => void>()
}))
vi.mock("@tauri-apps/api/core", () => ({ invoke }))
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, handler: (event: { payload: unknown }) => void) => {
    listeners.set(name, handler)
    return () => listeners.delete(name)
  }
}))
const action = (extra: Partial<ExtensionAction>): ExtensionAction => ({
  id: "blocker",
  name: "Blocker",
  title: "Blocker (3 blocked)",
  enabled: true,
  badge: "3",
  badgeColor: "#cc0000",
  popup: true,
  icon: "data:image/png;base64,AAAA",
  ...extra
})
let actions: ExtensionAction[] = []
let popupUrl = ""
let closing = false
beforeEach(() => {
  closing = false
  invoke.mockReset()
  listeners.clear()
  popupUrl = ""
  invoke.mockImplementation(async (command: string) => {
    if (command === "cef_guest_extension_actions") return actions
    if (command === "cef_guest_extension_trigger") return popupUrl
    if (command === "cef_open_guest") return { label: "popup-guest", token: "popup-token" }
    if (command === "cef_extension_popup_state") return { width: 300, height: 420, closing }
    return undefined
  })
})

test("each extension shows its button for this tab: tooltip, badge, and disabled where it does not apply", async () => {
  actions = [action({}), action({ id: "reader", name: "Reader", title: "", badge: "", enabled: false, icon: null })]
  render(<ExtensionActions label="tab" active revision="a" />)
  const blocker = await screen.findByRole("button", { name: "Blocker (3 blocked)" })
  expect(blocker).toBeEnabled()
  expect(blocker).toHaveTextContent("3")
  // No tooltip of its own: the extension's name; no icon: its initial.
  const reader = screen.getByRole("button", { name: "Reader" })
  expect(reader).toBeDisabled()
  expect(reader).toHaveTextContent("R")
  expect(invoke).toHaveBeenCalledWith("cef_guest_extension_actions", { label: "tab" })
})

test("the tab in front is named to the browser, and a tab behind is not", async () => {
  actions = []
  const view = render(<ExtensionActions label="behind" active={false} revision="a" />)
  await act(async () => {})
  expect(invoke).not.toHaveBeenCalledWith("cef_guest_extension_activate", expect.anything())
  view.rerender(<ExtensionActions label="behind" active revision="a" />)
  expect(invoke).toHaveBeenCalledWith("cef_guest_extension_activate", { label: "behind" })
})

test("a press is the browser's to interpret: without a popup the extension is told and nothing opens", async () => {
  actions = [action({ popup: false })]
  render(<ExtensionActions label="tab" active revision="a" />)
  fireEvent.click(await screen.findByRole("button", { name: "Blocker (3 blocked)" }))
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("cef_guest_extension_trigger", { label: "tab", id: "blocker" })
  )
  await act(async () => {})
  expect(invoke).not.toHaveBeenCalledWith("cef_open_guest", expect.anything())
})

test("a popup is the extension's own live page, sized by its content, and closes itself", async () => {
  actions = [action({})]
  popupUrl = "chrome-extension://blocker/popup.html"
  render(<ExtensionActions label="tab" active revision="a" />)
  fireEvent.click(await screen.findByRole("button", { name: "Blocker (3 blocked)" }))
  const surface = await screen.findByTitle("Blocker 弹出页")
  expect(invoke).toHaveBeenCalledWith("cef_open_guest", { url: "chrome-extension://blocker/popup.html" })
  expect(surface).toHaveAttribute("data-content-id", "popup-token")
  await waitFor(() => expect(surface).toHaveStyle({ width: "300px", height: "420px" }))
  // window.close() in the popup is a request; the popover follows and the guest is released.
  closing = true
  await waitFor(() => expect(screen.queryByTitle("Blocker 弹出页")).toBeNull())
  expect(invoke).toHaveBeenCalledWith("cef_close_guest", { label: "popup-guest" })
})

test("badge text stays readable on whatever colour the extension chose", () => {
  expect(badgeText("#cc0000")).toBe("#ffffff")
  expect(badgeText("#ffee00")).toBe("#000000")
  expect(badgeText("not a colour")).toBe("#ffffff")
})

test("a button changes when the browser says so, and one the user took out is not shown but still reported", async () => {
  const { hiddenExtensions } = await import("../extension-visibility")
  actions = [action({}), action({ id: "reader", name: "Reader", title: "", badge: "" })]
  const onActions = vi.fn()
  hiddenExtensions.setState(["reader"], true)
  try {
    render(<ExtensionActions label="tab" active revision="a" onActions={onActions} />)
    const blocker = await screen.findByRole("button", { name: "Blocker (3 blocked)" })
    expect(screen.queryByRole("button", { name: "Reader" })).toBeNull()
    await waitFor(() => expect(onActions).toHaveBeenLastCalledWith(actions))
    // Another tab's change is not this one's.
    const calls = invoke.mock.calls.length
    await act(async () => listeners.get("browser-extension-actions")!({ payload: { label: "other" } }))
    expect(invoke.mock.calls.length).toBe(calls)
    actions = [action({ badge: "4" }), actions[1]!]
    await act(async () => listeners.get("browser-extension-actions")!({ payload: { label: "tab" } }))
    await waitFor(() => expect(blocker).toHaveTextContent("4"))
    act(() => hiddenExtensions.setState([], true))
    expect(screen.getByRole("button", { name: "Reader" })).toBeInTheDocument()
  } finally {
    hiddenExtensions.setState([], true)
  }
})

test("a button the toolbar does not show can still be pressed, and is there while its popup is", async () => {
  const { hiddenExtensions } = await import("../extension-visibility")
  actions = [action({})]
  popupUrl = "chrome-extension://blocker/popup.html"
  hiddenExtensions.setState(["blocker"], true)
  try {
    const view = render(<ExtensionActions label="tab" active revision="a" />)
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("cef_guest_extension_actions", { label: "tab" }))
    await act(async () => {})
    expect(screen.queryByRole("button", { name: "Blocker (3 blocked)" })).toBeNull()
    view.rerender(<ExtensionActions label="tab" active revision="a" request={{ id: "blocker" }} />)
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("cef_guest_extension_trigger", { label: "tab", id: "blocker" })
    )
    expect(await screen.findByRole("button", { name: "Blocker (3 blocked)" })).toBeInTheDocument()
  } finally {
    hiddenExtensions.setState([], true)
  }
})
