import "./language"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { StrictMode } from "react"
import { beforeEach, expect, test, vi } from "vitest"

import { BrowserPane } from "../browser-pane"

const invoke = vi.hoisted(() => vi.fn())
// Extension buttons have their own suite; here they would only add calls to count.
vi.mock("../extension-actions", () => ({ ExtensionActions: () => null }))
vi.mock("@tauri-apps/api/core", () => ({ invoke }))
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }))
const props = { active: true }
beforeEach(() => invoke.mockReset())

test("mounts the live surface and releases its guest when removed", async () => {
  invoke.mockResolvedValueOnce({ label: "browser-test", token: "opaque-token" }).mockResolvedValue(undefined)
  const view = render(<BrowserPane {...props} />)
  await waitFor(() => expect(screen.getByTitle("实时网页")).toHaveAttribute("data-content-id", "opaque-token"))
  expect(screen.getByTitle("实时网页")).toHaveAttribute("type", "application/x-chromium-surface-embed")
  view.unmount()
  expect(invoke).toHaveBeenLastCalledWith("cef_close_guest", { label: "browser-test" })
})

test("releases a guest whose creation completes after the pane unmounts", async () => {
  let resolve!: (guest: { label: string; token: string }) => void
  invoke
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    .mockResolvedValue(undefined)
  const view = render(<BrowserPane {...props} />)
  view.unmount()
  await act(async () => resolve({ label: "browser-late", token: "late-token" }))
  expect(invoke).toHaveBeenLastCalledWith("cef_close_guest", { label: "browser-late" })
})

test("shows creation failures without mounting an empty surface", async () => {
  invoke.mockRejectedValueOnce(new Error("Guest creation failed"))
  render(<BrowserPane {...props} />)
  expect(await screen.findByRole("alert")).toHaveTextContent("Guest creation failed")
  expect(screen.queryByTitle("实时网页")).toBeNull()
})

test("address-bar navigation preserves the existing guest", async () => {
  invoke.mockResolvedValueOnce({ label: "browser-test", token: "opaque-token" }).mockResolvedValue(undefined)
  render(<BrowserPane {...props} />)
  await screen.findByTitle("实时网页")
  fireEvent.change(screen.getByRole("combobox", { name: "网页地址" }), { target: { value: "http://localhost:5173" } })
  fireEvent.submit(screen.getByRole("combobox", { name: "网页地址" }).closest("form")!)
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("cef_navigate_guest", { label: "browser-test", url: "http://localhost:5173" })
  )
  expect(invoke.mock.calls.filter(([name]) => name === "cef_open_guest")).toHaveLength(1)
})

test("acknowledges an AI open request after its live guest is ready", async () => {
  invoke.mockResolvedValueOnce({ label: "browser-ai", token: "surface" }).mockResolvedValue(undefined)
  render(<BrowserPane {...props} request={{ id: "open-1", url: "http://localhost:5173", sessionId: "chat-1" }} />)
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("cef_preview_ready", { id: "open-1", label: "browser-ai", error: null })
  )
  expect(invoke).toHaveBeenCalledWith("cef_open_guest", { url: "http://localhost:5173", requestId: "open-1" })
})

test("development effect replay does not cancel an AI tab open", async () => {
  let next = 0
  invoke.mockImplementation(async (command: string) =>
    command === "cef_open_guest" ? { label: `browser-${++next}`, token: `surface-${next}` } : undefined
  )
  render(
    <StrictMode>
      <BrowserPane {...props} request={{ id: "strict", url: "https://example.com" }} />
    </StrictMode>
  )
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("cef_preview_ready", { id: "strict", label: "browser-2", error: null })
  )
  expect(invoke.mock.calls.filter(([name, args]) => name === "cef_preview_ready" && args.error)).toHaveLength(0)
})

test("adopts the original popup through StrictMode without creating or closing it during replay", async () => {
  invoke.mockImplementation(async (command) =>
    command === "cef_guest_metadata"
      ? { label: "browser-popup-42", title: "Sign in", url: "https://login.example/" }
      : undefined
  )
  const adopted = { label: "browser-popup-42", token: "original-surface", url: "https://login.example/" }
  const onTitle = vi.fn()
  const view = render(
    <StrictMode>
      <BrowserPane {...props} adopted={adopted} onTitle={onTitle} />
    </StrictMode>
  )
  await waitFor(() => expect(screen.getByTitle("实时网页")).toHaveAttribute("data-content-id", "original-surface"))
  expect(invoke.mock.calls.some(([command]) => command === "cef_open_guest" || command === "cef_close_guest")).toBe(
    false
  )
  expect(screen.getByRole("combobox", { name: "网页地址" })).toHaveValue(adopted.url)
  await waitFor(() => expect(onTitle).toHaveBeenCalledWith("Sign in"))
  view.unmount()
  await waitFor(() =>
    expect(invoke.mock.calls.filter(([command]) => command === "cef_close_guest")).toEqual([
      ["cef_close_guest", { label: adopted.label }]
    ])
  )
})
