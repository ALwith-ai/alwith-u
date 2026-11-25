import "./language"

import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { StrictMode } from "react"
import { beforeEach, expect, test, vi } from "vitest"

import type { Pointed } from "../point"

const invoke = vi.fn<(command: string, args: Record<string, unknown>) => Promise<Pointed | null>>()
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: Parameters<typeof invoke>) => invoke(...args) }))
const prompt = vi.fn<(sessionId: string, blocks: unknown[]) => Promise<string>>()
vi.mock("@/lib/client", () => ({ client: { prompt: (...args: Parameters<typeof prompt>) => prompt(...args) } }))
const prepare = vi.fn<() => Promise<void>>()
vi.mock("../quick-chat-session", () => ({ prepareBrowserChat: () => prepare() }))

const { PagePointer } = await import("../page-pointer")
const { useBrowserQuickChat } = await import("../quick-chat-state")

const button: Pointed = {
  rect: [0.1, 0.2, 0.2, 0.1],
  kind: "button",
  name: "",
  text: "Buy now",
  around: "",
  selector: "#buy",
  block: ""
}
const onClose = vi.fn<() => void>()

function show() {
  const surface = document.createElement("embed")
  Object.defineProperties(surface, { offsetWidth: { value: 1000 }, offsetHeight: { value: 500 } })
  // Development mounts every effect twice; pointing has to work after the second mount too.
  render(
    <StrictMode>
      <PagePointer label="guest-1" surface={surface} url="https://shop.example/" onClose={onClose} />
    </StrictMode>
  )
  const layer = screen.getByRole("application", { name: "指给 AI 看" })
  layer.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 500)
  return layer
}

beforeEach(() => {
  vi.clearAllMocks()
  invoke.mockResolvedValue(button)
  prepare.mockImplementation(async () => {
    useBrowserQuickChat.setState({ sessionId: "browser-chat" })
  })
  prompt.mockResolvedValue("message-1")
  useBrowserQuickChat.setState({ sessionId: null, revealSessionId: null })
})

test("the thing under the pointer is asked of the page and outlined where it is", async () => {
  const layer = show()
  fireEvent.pointerMove(layer, { clientX: 150, clientY: 125 })
  await waitFor(() => expect(layer.querySelector("[data-browser-pointed]")).not.toBeNull())
  expect(invoke).toHaveBeenCalledWith("cef_guest_point", { label: "guest-1", x: 0.15, y: 0.25, describe: false })
  expect(layer.querySelector<HTMLElement>("[data-browser-pointed]")!.style).toMatchObject({
    left: "10%",
    top: "20%",
    width: "20%",
    height: "10%"
  })
})

test("a remark about the pointed thing goes to the browser's conversation at once", async () => {
  const layer = show()
  fireEvent.pointerDown(layer, { button: 0, clientX: 150, clientY: 125 })
  const box = await screen.findByRole("textbox", { name: "说说这里要怎样" })
  expect(invoke).toHaveBeenLastCalledWith("cef_guest_point", { label: "guest-1", x: 0.15, y: 0.25, describe: true })
  fireEvent.change(box, { target: { value: "改成蓝色" } })
  fireEvent.submit(box.closest("form")!)
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  expect(prompt).toHaveBeenCalledWith("browser-chat", [
    { type: "text", text: "改成蓝色" },
    {
      type: "resource",
      resource: {
        uri: "https://shop.example/",
        mimeType: "text/plain",
        text: "指着“Buy now”\npage: https://shop.example/\ntab: guest-1\nselector: css=#buy"
      }
    }
  ])
  // The conversation the remark went to is shown.
  expect(useBrowserQuickChat.getState().revealSessionId).toBe("browser-chat")
})

test("nothing is sent without words, and a failed remark stays to be sent again", async () => {
  const layer = show()
  fireEvent.pointerDown(layer, { button: 0, clientX: 150, clientY: 125 })
  const box = await screen.findByRole("textbox", { name: "说说这里要怎样" })
  fireEvent.submit(box.closest("form")!)
  expect(prepare).not.toHaveBeenCalled()
  prompt.mockRejectedValueOnce(new Error("offline"))
  fireEvent.change(box, { target: { value: "改成蓝色" } })
  fireEvent.submit(box.closest("form")!)
  await waitFor(() => expect(prompt).toHaveBeenCalledOnce())
  await waitFor(() => expect(box).not.toBeDisabled())
  expect(onClose).not.toHaveBeenCalled()
  expect(box).toHaveValue("改成蓝色")
})

test("Escape lets go of the chosen thing first, then stops pointing", async () => {
  const layer = show()
  fireEvent.pointerDown(layer, { button: 0, clientX: 150, clientY: 125 })
  await screen.findByRole("textbox", { name: "说说这里要怎样" })
  fireEvent.keyDown(layer, { key: "Escape" })
  expect(screen.queryByRole("textbox")).toBeNull()
  expect(onClose).not.toHaveBeenCalled()
  fireEvent.keyDown(layer, { key: "Escape" })
  expect(onClose).toHaveBeenCalledOnce()
})

test("turning the wheel scrolls the page under the pointer, and the outline follows", async () => {
  const layer = show()
  fireEvent.wheel(layer, { clientX: 500, clientY: 250, deltaY: 120 })
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("cef_guest_wheel", { label: "guest-1", x: 0.5, y: 0.5, deltaX: 0, deltaY: 120 })
  )
  // What is under the pointer now is asked for again.
  await waitFor(() =>
    expect(invoke).toHaveBeenLastCalledWith("cef_guest_point", { label: "guest-1", x: 0.5, y: 0.5, describe: false })
  )
})

test("the page does not move under a remark being written", async () => {
  const layer = show()
  fireEvent.pointerDown(layer, { button: 0, clientX: 150, clientY: 125 })
  await screen.findByRole("textbox", { name: "说说这里要怎样" })
  fireEvent.wheel(layer, { clientX: 500, clientY: 250, deltaY: 120 })
  expect(invoke).not.toHaveBeenCalledWith("cef_guest_wheel", expect.anything())
})

test("a point chosen from the page's menu is chosen from the start", async () => {
  const surface = document.createElement("embed")
  Object.defineProperties(surface, { offsetWidth: { value: 1000 }, offsetHeight: { value: 500 } })
  render(
    <PagePointer
      label="guest-1"
      surface={surface}
      url="https://shop.example/"
      start={{ x: 0.3, y: 0.4 }}
      onClose={onClose}
    />
  )
  await screen.findByRole("textbox", { name: "说说这里要怎样" })
  expect(invoke).toHaveBeenCalledWith("cef_guest_point", { label: "guest-1", x: 0.3, y: 0.4, describe: true })
})
