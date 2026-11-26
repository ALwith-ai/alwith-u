import "./language"

import type { DraftPort } from "@alwith/module-voice/chat"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { StrictMode } from "react"
import { beforeEach, expect, test, vi } from "vitest"

import type { Pointed } from "../point"

const invoke = vi.fn<(command: string, args: Record<string, unknown>) => Promise<Pointed | string | null>>()
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: Parameters<typeof invoke>) => invoke(...args) }))
const prompt = vi.fn<(sessionId: string, blocks: unknown[]) => Promise<string>>()
vi.mock("@/lib/client", () => ({ client: { prompt: (...args: Parameters<typeof prompt>) => prompt(...args) } }))
const prepare = vi.fn<() => Promise<void>>()
vi.mock("../quick-chat-session", () => ({ prepareBrowserChat: () => prepare() }))
const voiceDraft = vi.fn<(draft: DraftPort) => void>()
vi.mock("@/features/voice/voice-button", () => ({
  VoiceButton: ({ draft }: { draft: DraftPort }) => {
    voiceDraft(draft)
    return null
  }
}))

const { PagePointer } = await import("../page-pointer")
const { useBrowserQuickChat } = await import("../quick-chat-state")
const onClose = vi.fn()

const button: Pointed = {
  rect: [0.1, 0.2, 0.2, 0.1],
  kind: "button",
  name: "",
  text: "Buy now",
  around: "",
  selector: "#buy",
  block: ""
}
function show() {
  const surface = document.createElement("embed")
  Object.defineProperties(surface, { offsetWidth: { value: 1000 }, offsetHeight: { value: 500 } })
  // Development mounts every effect twice; pointing has to work after the second mount too.
  const view = render(
    <StrictMode>
      <PagePointer label="guest-1" surface={surface} url="https://shop.example/" onClose={onClose} />
    </StrictMode>
  )
  const layer = screen.getByRole("application", { name: "指给 AI 看" })
  layer.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 500)
  layer.setPointerCapture = vi.fn()
  layer.hasPointerCapture = () => false
  return { layer, view }
}

function clickPage(layer: HTMLElement, position: { clientX: number; clientY: number }) {
  const event = { button: 0, pointerId: 1, ...position }
  fireEvent.pointerDown(layer, event)
  fireEvent.pointerUp(layer, event)
}

beforeEach(() => {
  vi.clearAllMocks()
  invoke.mockResolvedValue(button)
  prepare.mockImplementation(async () => {
    useBrowserQuickChat.setState({ sessionId: "browser-chat" })
  })
  prompt.mockResolvedValue("message-1")
  useBrowserQuickChat.setState({ sessionId: null, revealSessionId: null, expanded: false })
})

test("the thing under the pointer is asked of the page and outlined where it is", async () => {
  const { layer } = show()
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

test("a remark goes to the browser's conversation and leaves pointing active", async () => {
  const { layer } = show()
  clickPage(layer, { clientX: 150, clientY: 125 })
  const box = await screen.findByRole("textbox", { name: "说说这里要怎样" })
  expect(invoke).toHaveBeenLastCalledWith("cef_guest_point", { label: "guest-1", x: 0.15, y: 0.25, describe: true })
  fireEvent.change(box, { target: { value: "改成蓝色" } })
  fireEvent.submit(box.closest("form")!)
  await waitFor(() => expect(box).not.toBeInTheDocument())
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
  expect(useBrowserQuickChat.getState()).toMatchObject({ expanded: false, revealSessionId: null })
  expect(onClose).not.toHaveBeenCalled()
  expect(layer).toHaveFocus()
  clickPage(layer, { clientX: 350, clientY: 125 })
  expect(await screen.findByRole("textbox")).toHaveValue("")
})

test("dragging in either direction uses the rectangle and attaches only its screenshot on send", async () => {
  const { layer } = show()
  fireEvent.pointerDown(layer, { button: 0, pointerId: 1, clientX: 500, clientY: 375 })
  fireEvent.pointerMove(layer, { pointerId: 1, clientX: 250, clientY: 125 })
  expect(screen.queryByRole("textbox")).toBeNull()
  expect(layer.querySelector<HTMLElement>("[data-browser-pointed]")!.style).toMatchObject({
    left: "25%",
    top: "25%",
    width: "25%",
    height: "50%"
  })
  fireEvent.pointerUp(layer, { pointerId: 1, clientX: 250, clientY: 125 })
  const box = await screen.findByRole("textbox")
  expect(invoke).not.toHaveBeenCalled()
  invoke.mockResolvedValueOnce("aW1hZ2U=")
  fireEvent.change(box, { target: { value: "看这个区域" } })
  fireEvent.submit(box.closest("form")!)
  await waitFor(() => expect(box).not.toBeInTheDocument())
  expect(invoke).toHaveBeenCalledExactlyOnceWith("cef_guest_region_screenshot", {
    label: "guest-1",
    url: "https://shop.example/",
    rect: [0.25, 0.25, 0.25, 0.5]
  })
  expect(prompt).toHaveBeenCalledExactlyOnceWith("browser-chat", [
    { type: "text", text: "看这个区域" },
    {
      type: "resource",
      resource: {
        uri: "https://shop.example/",
        mimeType: "text/plain",
        text: "框选区域\npage: https://shop.example/\ntab: guest-1\nrectangle in visible page: left 25.00%, top 25.00%, width 25.00%, height 50.00%"
      }
    },
    { type: "image", mimeType: "image/png", data: "aW1hZ2U=" }
  ])
  expect(onClose).not.toHaveBeenCalled()
  expect(useBrowserQuickChat.getState()).toMatchObject({ expanded: false, revealSessionId: null })
})

test("a screenshot failure preserves the selected region and draft for retry", async () => {
  const { layer } = show()
  fireEvent.pointerDown(layer, { button: 0, pointerId: 1, clientX: 120, clientY: 80 })
  fireEvent.pointerUp(layer, { pointerId: 1, clientX: 250, clientY: 160 })
  const box = await screen.findByRole("textbox")
  fireEvent.change(box, { target: { value: "看这个区域" } })
  invoke.mockRejectedValueOnce(new Error("Capture failed")).mockResolvedValueOnce("aW1hZ2U=")
  fireEvent.submit(box.closest("form")!)
  await waitFor(() => expect(box).toBeEnabled())
  expect(prepare).not.toHaveBeenCalled()
  expect(prompt).not.toHaveBeenCalled()
  expect(box).toHaveValue("看这个区域")
  expect(layer.querySelector("[data-browser-pointed]")).toBeInTheDocument()
  fireEvent.submit(box.closest("form")!)
  await waitFor(() => expect(prompt).toHaveBeenCalledOnce())
})

test("Escape during a drag cancels only that gesture", () => {
  const { layer } = show()
  fireEvent.pointerDown(layer, { button: 0, pointerId: 1, clientX: 100, clientY: 125 })
  fireEvent.pointerMove(layer, { pointerId: 1, clientX: 350, clientY: 250 })
  expect(layer.querySelector("[data-browser-pointed]")).toBeInTheDocument()
  fireEvent.keyDown(layer, { key: "Escape" })
  fireEvent.pointerUp(layer, { pointerId: 1, clientX: 350, clientY: 250 })
  expect(layer.querySelector("[data-browser-pointed]")).toBeNull()
  expect(screen.queryByRole("textbox")).toBeNull()
  expect(onClose).not.toHaveBeenCalled()
  expect(invoke).not.toHaveBeenCalled()
})

test("nothing is sent without words, and a failed remark stays to be sent again", async () => {
  const { layer } = show()
  clickPage(layer, { clientX: 150, clientY: 125 })
  const box = await screen.findByRole("textbox", { name: "说说这里要怎样" })
  fireEvent.submit(box.closest("form")!)
  expect(prepare).not.toHaveBeenCalled()
  prompt.mockRejectedValueOnce(new Error("offline"))
  fireEvent.change(box, { target: { value: "改成蓝色" } })
  fireEvent.submit(box.closest("form")!)
  await waitFor(() => expect(prompt).toHaveBeenCalledOnce())
  await waitFor(() => expect(box).not.toBeDisabled())
  expect(box).toHaveValue("改成蓝色")
})

test("a recording writes to its own draft and a late result cannot fill the next remark", async () => {
  const { layer } = show()
  clickPage(layer, { clientX: 150, clientY: 125 })
  const box = await screen.findByRole("textbox")
  const draft = voiceDraft.mock.lastCall![0]
  act(() => {
    draft.compareAndSet(draft.read(), "改成蓝色", [5, 5])
  })
  expect(box).toHaveValue("改成蓝色")
  expect(prompt).not.toHaveBeenCalled()
  clickPage(layer, { clientX: 350, clientY: 125 })
  await waitFor(() => expect(box).not.toBeInTheDocument())
  const next = await screen.findByRole("textbox")
  act(() => {
    draft.compareAndSet(draft.read(), "旧目标的转写", [0, 0])
  })
  expect(next).toHaveValue("")
})

test("a draft is preserved until a different target is resolved", async () => {
  const { layer } = show()
  clickPage(layer, { clientX: 100, clientY: 125 })
  const box = await screen.findByRole("textbox")
  fireEvent.change(box, { target: { value: "旧草稿" } })
  const failed = Promise.withResolvers<Pointed>()
  invoke.mockReturnValueOnce(failed.promise)
  clickPage(layer, { clientX: 350, clientY: 125 })
  expect(box).toHaveValue("旧草稿")
  await act(async () => failed.reject(new Error("Lookup failed")))
  expect(box).toHaveValue("旧草稿")
  clickPage(layer, { clientX: 350, clientY: 125 })
  await waitFor(() => expect(box).not.toBeInTheDocument())
  expect(screen.getByRole("textbox")).toHaveValue("")
})

test("closing pointing does not cancel a message already submitted during chat preparation", async () => {
  const { promise, resolve } = Promise.withResolvers<void>()
  prepare.mockImplementationOnce(async () => {
    await promise
    useBrowserQuickChat.setState({ sessionId: "browser-chat" })
  })
  const { layer, view } = show()
  clickPage(layer, { clientX: 100, clientY: 125 })
  const box = await screen.findByRole("textbox")
  fireEvent.change(box, { target: { value: "待发送" } })
  fireEvent.submit(box.closest("form")!)
  expect(prepare).toHaveBeenCalledOnce()
  view.unmount()
  await act(async () => resolve())
  expect(prompt).toHaveBeenCalledOnce()
})

test("Escape in the overlay clears the target first and exits on the next press", async () => {
  const { layer } = show()
  clickPage(layer, { clientX: 100, clientY: 125 })
  const box = await screen.findByRole("textbox")
  fireEvent.keyDown(document.body, { key: "Escape" })
  expect(box).toBeInTheDocument()
  fireEvent.keyDown(box, { key: "Escape" })
  expect(box).not.toBeInTheDocument()
  expect(onClose).not.toHaveBeenCalled()
  expect(layer).toHaveFocus()
  fireEvent.keyDown(layer, { key: "Escape" })
  expect(onClose).toHaveBeenCalledOnce()
})

test("turning the wheel scrolls the page under the pointer, and the outline follows", async () => {
  const { layer } = show()
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
  const { layer } = show()
  clickPage(layer, { clientX: 150, clientY: 125 })
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
