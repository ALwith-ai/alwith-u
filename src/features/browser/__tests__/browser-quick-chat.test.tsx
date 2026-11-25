import { mockOf } from "@/test/mock-of"
import "./language"
import type { SessionRunState } from "@alwith/api"
import { applyUpdate, createSession } from "@alwith/module-chat/client"
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import { ThemeProvider } from "@/components/theme-provider"
import * as clientModule from "@/lib/client"

import { BrowserQuickChat } from "../browser-quick-chat"
import { useBrowserQuickChat } from "../quick-chat-state"

vi.mock("../quick-chat-session", () => ({ prepareBrowserChat: vi.fn(async () => {}) }))
vi.mock("@/features/chat/codex/navigation-audio", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/chat/codex/navigation-audio")>()),
  preloadTimelineUserMessageNavigationInstrument: vi.fn()
}))
const windowFocus = vi.hoisted(() => ({ onChange: (_event: { payload: boolean }) => {} }))
vi.mock("@tauri-apps/api/webviewWindow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/webviewWindow")>()),
  getCurrentWebviewWindow: () => ({
    isFocused: async () => false,
    onFocusChanged: async (callback: typeof windowFocus.onChange) => {
      windowFocus.onChange = callback
      return () => {}
    }
  })
}))
const original = useBrowserQuickChat.getState()
const originalClient = clientModule.client.state
class Pointer extends MouseEvent {
  readonly pointerId: number
  constructor(type: string, options: PointerEventInit = {}) {
    super(type, options)
    this.pointerId = options.pointerId ?? 1
  }
}
beforeEach(() => {
  vi.stubGlobal("PointerEvent", Pointer)
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000)
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(700)
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const width = Number.parseFloat(this.style.width) || 1000
    const height = Number.parseFloat(this.style.height) || 700
    const translation = this.style.transform.match(/translate3d\((.*?), (.*?), 0(?:px)?\)/)
    const coordinate = (value: string | undefined, size: number) => {
      if (!value) return 0
      const normalized = value.replace(/\s/g, "")
      const pixels = normalized.match(/(-?[\d.]+)px/)
      const percent = normalized.match(/(-?[\d.]+)%/)
      return Number(pixels?.[1] ?? 0) + (Number(percent?.[1] ?? 0) * size) / 100
    }
    const x = (Number.parseFloat(this.style.left) || 0) + coordinate(translation?.[1], width)
    const y = (Number.parseFloat(this.style.top) || 0) + coordinate(translation?.[2], height)
    return { x, y, width, height, left: x, top: y, right: x + width, bottom: y + height, toJSON: () => ({}) }
  })
  useBrowserQuickChat.setState({
    revealSessionId: null,
    sessionId: null,
    cwd: null,
    expanded: true,
    side: "right",
    edge: "bottom",
    size: { width: 560, height: 640 }
  })
})
afterEach(() => {
  cleanup()
  useBrowserQuickChat.setState(original, true)
  clientModule.client.store.setState(originalClient, true)
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderExpanded() {
  const view = render(<BrowserQuickChat active />)
  act(() => useBrowserQuickChat.setState({ expanded: true }))
  return view
}

function capture(element: HTMLElement) {
  element.setPointerCapture = vi.fn()
  element.hasPointerCapture = vi.fn(() => false)
}

test.each([
  { target: "width", expected: { width: 640, height: 640 } },
  { target: "height", expected: { width: 560, height: 668 } }
])("the $target edge changes only its own dimension during diagonal movement", async ({ target, expected }) => {
  const view = renderExpanded()
  await waitFor(() => expect(view.container.querySelector('[aria-busy="true"]')).toBeNull())
  expect(view.container.querySelector('[data-quick-chat-resize="corner"]')).toBeNull()
  const handle = view.container.querySelector(`[data-quick-chat-resize="${target}"]`) as HTMLElement
  const surface = view.container.querySelector("[data-browser-quick-chat]")!.firstElementChild as HTMLElement
  capture(handle)
  fireEvent.pointerDown(handle, { pointerId: 7, button: 0, clientX: 430, clientY: 60 })
  fireEvent.pointerMove(surface, { pointerId: 7, clientX: 350, clientY: 20 })
  expect(surface.style.transition).toBe("none")
  fireEvent.pointerUp(surface, { pointerId: 7, clientX: 350, clientY: 20 })
  expect(useBrowserQuickChat.getState().size).toEqual(expected)
})

test("the header uses only collapse and new-chat icons plus a drag grip, without title text", async () => {
  const view = renderExpanded()
  await waitFor(() => expect(view.container.querySelector('[aria-busy="true"]')).toBeNull())
  const header = view.container.querySelector("header")!
  expect(header.firstElementChild).toHaveAttribute("aria-label", "收起浏览器聊天")
  expect(header.lastElementChild).toHaveAttribute("data-quick-chat-drag")
  const button = view.getByRole("button", { name: "新聊天" })
  expect(button.textContent).toBe("")
  expect(header.textContent).toBe("")
  expect(header.className).toContain("px-3")
  expect(header.className).not.toMatch(/p[lr]-/)
})

test.each([
  { side: "left", edge: "top", x: "16px", y: "16px" },
  { side: "right", edge: "top", x: "944px", y: "16px" },
  { side: "left", edge: "bottom", x: "16px", y: "644px" },
  { side: "right", edge: "bottom", x: "944px", y: "644px" }
] as const)("collapse and expansion retain the $side $edge corner", async ({ side, edge, x, y }) => {
  const view = renderExpanded()
  await waitFor(() => expect(view.container.querySelector('[aria-busy="true"]')).toBeNull())
  act(() => useBrowserQuickChat.setState({ side, edge }))
  vi.useFakeTimers()
  fireEvent.click(view.getByRole("button", { name: "收起浏览器聊天" }))
  const surface = view.container.querySelector("[data-browser-quick-chat]")!.firstElementChild as HTMLElement
  expect(view.container.querySelector('[aria-label="展开浏览器聊天"]')).toHaveAttribute("aria-hidden", "true")
  const panelNode = view.container.querySelector("[data-quick-chat-panel]")
  const dockTransform = surface.style.transform
  const panelPosition = { left: side === "left" ? 16 : 424, top: edge === "top" ? 16 : 44 }
  expect(view.container.querySelector<HTMLElement>("[data-quick-chat-panel]")!.style.opacity).toBe("0")
  expect(surface.style.width).toBe("40px")
  expect(surface.style.height).toBe("40px")
  act(() => {
    vi.advanceTimersByTime(260)
  })
  const button = view.getByRole("button", { name: "展开浏览器聊天" })
  expect(button).toHaveClass("size-10")
  expect(button).not.toBeDisabled()
  expect(surface.style.width).toBe("40px")
  expect(surface.style.height).toBe("40px")
  expect(surface.getBoundingClientRect().left).toBe(Number.parseFloat(x))
  expect(surface.getBoundingClientRect().top).toBe(Number.parseFloat(y))
  expect(surface.style.transform).toBe(dockTransform)
  expect(view.container.querySelector("[data-quick-chat-panel]")).toBe(panelNode)
  fireEvent.click(button)
  expect(useBrowserQuickChat.getState()).toMatchObject({ expanded: true, side, edge })
  expect(surface.getBoundingClientRect().left).toBe(panelPosition.left)
  expect(surface.getBoundingClientRect().top).toBe(panelPosition.top)
  expect(surface.style.transform).toBe(dockTransform)
  expect(view.container.querySelector("[data-quick-chat-panel]")).toBe(panelNode)
  vi.useRealTimers()
})

test("opening the browser starts collapsed without changing its conversation", async () => {
  const view = renderExpanded()
  await waitFor(() => expect(view.container.querySelector('[aria-busy="true"]')).toBeNull())
  view.rerender(<BrowserQuickChat active={false} />)
  view.rerender(<BrowserQuickChat active />)
  expect(useBrowserQuickChat.getState().expanded).toBe(false)
  expect(view.getByRole("button", { name: "展开浏览器聊天" })).toBeEnabled()
})

test("a completed browser chat stays blue until its response is visible in the focused window", async () => {
  const sessionId = "browser"
  const session = applyUpdate(
    { ...createSession(sessionId, "/tmp"), attached: true },
    {
      sessionUpdate: "agent_message",
      messageId: "reply",
      content: [{ type: "text", text: "Browser reply" }]
    }
  )
  const done: SessionRunState = {
    sessionId,
    state: "done",
    version: 7,
    reusableDraft: false,
    owner: "",
    cwd: session.cwd,
    title: "Browser chat",
    since: 0,
    lastActivityAt: 0,
    interruption: null,
    tasks: [],
    listeningPorts: [],
    executionId: null,
    executionRole: null
  }
  const markRead = vi.spyOn(clientModule, "markRead").mockResolvedValue()
  vi.spyOn(document, "hasFocus").mockReturnValue(false)
  clientModule.client.store.setState({ sessions: { [sessionId]: session } })
  clientModule.client.applyRunStates([done])
  useBrowserQuickChat.setState({ sessionId, cwd: session.cwd })
  const view = render(<BrowserQuickChat active />, { wrapper: ThemeProvider })
  const launch = view.getByRole("button", { name: "展开浏览器聊天" })
  expect(view.getByLabelText("未读回复")).toHaveClass("bg-blue-500")
  act(() => windowFocus.onChange({ payload: true }))
  expect(markRead).not.toHaveBeenCalled()

  act(() => windowFocus.onChange({ payload: false }))
  fireEvent.click(launch)
  await waitFor(() => expect(view.container.querySelector('[aria-busy="true"]')).toBeNull())
  expect(markRead).not.toHaveBeenCalled()

  act(() => windowFocus.onChange({ payload: true }))
  expect(markRead).toHaveBeenCalledExactlyOnceWith(sessionId, 7)
  expect(clientModule.client.state.runStates[sessionId]?.state).toBe("done")

  act(() => clientModule.client.applyRunStates([{ ...done, state: "running", version: 8 }]))
  act(() => clientModule.client.applyRunStates([{ ...done, version: 9 }]))
  expect(markRead.mock.calls).toEqual([
    [sessionId, 7],
    [sessionId, 9]
  ])
  act(() => clientModule.client.applyRunStates([{ ...done, state: "idle", version: 10 }]))
  expect(view.queryByLabelText("未读回复")).toBeNull()
})

test("Escape cancels queued drag frames without saving a different anchor", async () => {
  const view = renderExpanded()
  await waitFor(() => expect(view.container.querySelector('[aria-busy="true"]')).toBeNull())
  const handle = view.container.querySelector("header") as HTMLElement
  capture(handle)
  fireEvent.pointerDown(handle, { pointerId: 3, button: 0, clientX: 600, clientY: 60 })
  fireEvent.pointerMove(handle, { pointerId: 3, clientX: 100, clientY: 60 })
  fireEvent.keyDown(window, { key: "Escape" })
  await act(() => new Promise((resolve) => requestAnimationFrame(resolve)))
  expect(useBrowserQuickChat.getState().side).toBe("right")
  const surface = view.container.querySelector("[data-browser-quick-chat]")!.firstElementChild as HTMLElement
  expect(surface.getBoundingClientRect()).toMatchObject({ left: 424, top: 44 })
})

test("the floating entry keeps a transform transition for snapping after drag release", async () => {
  const view = render(<BrowserQuickChat active />)
  await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  const button = view.getByRole("button", { name: "展开浏览器聊天" })
  capture(button)
  const surface = view.container.querySelector("[data-browser-quick-chat]")!.firstElementChild as HTMLElement
  fireEvent.pointerDown(button, { pointerId: 9, button: 0, clientX: 960, clientY: 660 })
  fireEvent.pointerMove(surface, { pointerId: 9, clientX: 100, clientY: 100 })
  expect(surface.style.transition).toBe("none")
  fireEvent.pointerUp(surface, { pointerId: 9, clientX: 100, clientY: 100 })
  expect(surface.style.transition).toBe("")
  expect(surface.className).toContain("transition-[transform,width,height,border-radius]")
  expect(surface.getBoundingClientRect()).toMatchObject({ left: 16, top: 16 })
})

test("an activity reveal request survives browser activation and expands its existing association", async () => {
  const view = render(<BrowserQuickChat active={false} />)
  act(() => useBrowserQuickChat.setState({ sessionId: "browser", cwd: "/tmp", revealSessionId: "browser" }))
  expect(useBrowserQuickChat.getState().revealSessionId).toBe("browser")
  view.rerender(<BrowserQuickChat active />)
  expect(useBrowserQuickChat.getState()).toMatchObject({ expanded: true, revealSessionId: null })
  expect(view.getByRole("button", { name: "收起浏览器聊天" })).toBeEnabled()
  await waitFor(() => expect(view.container.querySelector('[aria-busy="true"]')).toBeNull())
})

test.each(["header", "header > div", "[data-quick-chat-drag]"])(
  "the entire header drags through %s",
  async (selector) => {
    const view = renderExpanded()
    await waitFor(() => expect(view.container.querySelector('[aria-busy="true"]')).toBeNull())
    const header = view.container.querySelector("header")!
    capture(header)
    const target = view.container.querySelector(selector)!
    const surface = view.container.querySelector("[data-browser-quick-chat]")!.firstElementChild!
    fireEvent.pointerDown(target, { pointerId: 3, button: 0, clientX: 600, clientY: 60 })
    fireEvent.pointerMove(surface, { pointerId: 3, clientX: 100, clientY: 60 })
    fireEvent.pointerUp(surface, { pointerId: 3, clientX: 100, clientY: 60 })
    expect(useBrowserQuickChat.getState().side).toBe("left")
  }
)

test("header controls never start a drag", async () => {
  const view = renderExpanded()
  await waitFor(() => expect(view.container.querySelector('[aria-busy="true"]')).toBeNull())
  const header = view.container.querySelector("header")!
  capture(header)
  for (const button of header.querySelectorAll("button")) {
    fireEvent.pointerDown(button, { pointerId: 3, button: 0, clientX: 600, clientY: 60 })
  }
  expect(mockOf(header, "setPointerCapture")).not.toHaveBeenCalled()
})
