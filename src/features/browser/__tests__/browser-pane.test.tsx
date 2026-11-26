import "./language"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { StrictMode } from "react"
import { beforeEach, expect, test, vi } from "vitest"

import { BrowserPane } from "../browser-pane"

const invoke = vi.hoisted(() => vi.fn())
const tabUpdates = vi.hoisted(() => vi.fn<(payload: { label: string; url: string }) => void>())
// Extension buttons have their own suite; here they would only add calls to count.
vi.mock("../extension-actions", () => ({ ExtensionActions: () => null }))
vi.mock("../page-pointer", () => ({ PagePointer: () => <input aria-label="批注" /> }))
vi.mock("@tauri-apps/api/core", () => ({ invoke }))
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (event: string, handler: (event: { payload: { label: string; url: string } }) => void) => {
    if (event === "browser-tab-updated") tabUpdates.mockImplementation((payload) => handler({ payload }))
    return () => {}
  }
}))
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

test("navigation within a tab keeps its pointing overlay and toolbar toggle", async () => {
  invoke.mockResolvedValueOnce({ label: "browser-test", token: "surface" }).mockResolvedValue(undefined)
  render(<BrowserPane {...props} request={{ id: "point-1", url: "https://example.com" }} />)
  const toggle = screen.getByRole("button", { name: "指给 AI 看" })
  await waitFor(() => expect(toggle).toBeEnabled())
  fireEvent.click(toggle)
  const remark = await screen.findByRole("textbox", { name: "批注" })
  expect(toggle).toHaveAttribute("aria-pressed", "true")
  act(() => tabUpdates({ label: "browser-test", url: "https://example.org" }))
  expect(remark).toBeInTheDocument()
  expect(toggle).toHaveAttribute("aria-pressed", "true")
  fireEvent.click(toggle)
  expect(toggle).toHaveAttribute("aria-pressed", "false")
})

test("switching tabs preserves each tab's own pointing toggle", async () => {
  invoke.mockResolvedValue({ label: "browser-test", token: "surface" })
  const tabs = (firstSelected: boolean) => (
    <>
      <div aria-hidden={!firstSelected}>
        <BrowserPane active={firstSelected} initialUrl="https://first.example" />
      </div>
      <div aria-hidden={firstSelected}>
        <BrowserPane active={!firstSelected} initialUrl="https://second.example" />
      </div>
    </>
  )
  const view = render(tabs(true))
  const toggle = () => screen.getByRole("button", { name: "指给 AI 看" })
  await waitFor(() => expect(toggle()).toBeEnabled())
  fireEvent.click(toggle())
  expect(toggle()).toHaveAttribute("aria-pressed", "true")
  view.rerender(tabs(false))
  expect(toggle()).toHaveAttribute("aria-pressed", "false")
  view.rerender(tabs(true))
  expect(toggle()).toHaveAttribute("aria-pressed", "true")
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
