import "./language"
import { act, render, screen, waitFor } from "@testing-library/react"
import { useEffect, useRef } from "react"
import { beforeEach, expect, test, vi } from "vitest"

import { BrowserWorkspace } from "../browser-workspace"

const native = vi.hoisted(() => ({
  controls: {} as Record<string, { sessionId: string; stopping: boolean }>,
  changed: () => {}
}))
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (command: string) => (command === "web_automation_controls" ? native.controls : undefined)
}))
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (event: string, handler: () => void) => {
    if (event === "browser-control-changed") native.changed = handler
    return () => {}
  }
}))
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ onFocusChanged: async () => () => {} }) }))
vi.mock("../browser-quick-chat", () => ({ BrowserQuickChat: () => null }))
vi.mock("../browser-pane", () => ({
  BrowserPane: ({ request, onGuest }: { request?: { id: string }; onGuest: (label: string) => void }) => {
    // The guest of a request is named after it, as the native side names one after its tab.
    // Once, as a guest is created once: the callback is a new function on every render.
    const named = useRef(false)
    useEffect(() => {
      if (!request || named.current) return
      named.current = true
      onGuest(`guest-${request.id}`)
    })
    return <div />
  }
}))

const sizes: ResizeObserverCallback[] = []
beforeEach(() => {
  native.controls = {}
  sizes.length = 0
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        sizes.push(callback)
      }
      observe() {}
      disconnect() {}
    }
  )
})
const props = { maximized: false, onMaximize: vi.fn(), onClose: vi.fn() }
const first = { id: "a", url: "https://first.example/", sessionId: "ai-a" }
const second = { id: "b", url: "https://second.example/", sessionId: "ai-b" }
const control = async (controls: typeof native.controls) => {
  native.controls = controls
  await act(async () => native.changed())
}
/** Two tabs of two conversations; the second is the one shown. */
async function open(active = true) {
  const view = render(<BrowserWorkspace {...props} active={active} request={first} />)
  view.rerender(<BrowserWorkspace {...props} active={active} request={second} />)
  await screen.findByRole("tab", { name: /second.example/ })
  const behind = () =>
    screen.getAllByRole("tabpanel", { hidden: true }).find((panel) => panel.getAttribute("aria-hidden") === "true")!
  return { view, behind }
}

test("a tab behind the shown one is hidden, until a conversation works on it", async () => {
  const { behind } = await open()
  expect(behind()).toHaveClass("invisible")
  await control({ "guest-a": { sessionId: "ai-a", stopping: false } })
  // Out of sight, not hidden: a hidden surface is drawn twice a second.
  await waitFor(() => expect(behind()).not.toHaveClass("invisible"))
  expect(behind()).toHaveClass("translate-x-full", "pointer-events-none")
  expect(behind()).toHaveAttribute("aria-hidden", "true")
  expect(behind()).toHaveAttribute("inert")
  expect(behind().parentElement).toHaveClass("overflow-hidden")
  await control({})
  await waitFor(() => expect(behind()).toHaveClass("invisible"))
})

test("a closed browser keeps the size it was shown at while a conversation works in it", async () => {
  const { view } = await open()
  const workspace = screen.getByRole("region", { name: "网页工作区" })
  act(() => {
    for (const report of sizes)
      report([{ contentRect: { width: 490, height: 644 } } as ResizeObserverEntry], {} as ResizeObserver)
  })
  view.rerender(<BrowserWorkspace {...props} active={false} request={second} />)
  // Nobody works in it: closed, it takes the width of its pane, which is none.
  expect(workspace.style.width).toBe("")
  await control({ "guest-a": { sessionId: "ai-a", stopping: false } })
  await waitFor(() => expect(workspace).toHaveStyle({ width: "490px", height: "644px", flex: "none" }))
  view.rerender(<BrowserWorkspace {...props} active request={second} />)
  expect(workspace.style.width).toBe("")
})
