import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { useEffect } from "react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import type { ThreadSummary } from "@/agent/client"
import {
  NavigationSessionItem,
  useNavigationHoverCardClose,
  useNavigationHoverCardPin
} from "@/features/layout/components/navigation/navigation-session-item"
import { VirtualThreadRows } from "../virtual-thread-rows"

const entries: ThreadSummary[] = Array.from({ length: 1000 }, (_, index) => ({
  sessionId: String(index),
  cwd: "/project",
  title: `Chat ${index}`,
  updatedAt: null,
  archived: false
}))
let viewport: HTMLDivElement
let height: number
let offset: number
const observers = new Set<ResizeObserverCallback>()

beforeEach(() => {
  height = 320
  offset = 0
  viewport = document.createElement("div")
  document.body.append(viewport)
  Object.defineProperty(viewport, "clientHeight", { get: () => height })
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const top = this.dataset.slot === "virtual-thread-rows" ? offset - viewport.scrollTop : 0
    return { x: 0, y: top, top, bottom: top + height, left: 0, right: 200, width: 200, height, toJSON() {} }
  })
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: ResizeObserverCallback) {
        observers.add(callback)
      }
      observe() {}
      unobserve() {}
      disconnect() {
        observers.delete(this.callback)
      }
    }
  )
})
afterEach(() => {
  cleanup()
  viewport.remove()
  observers.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function show(threads = entries) {
  return render(
    <VirtualThreadRows
      threads={threads}
      viewport={viewport}
      renderRow={thread => (
        <button type="button" data-session-id={thread.sessionId}>
          {thread.title}
        </button>
      )}
    />,
    { container: viewport, baseElement: document.body }
  )
}
async function scroll(top: number) {
  await act(async () => {
    viewport.scrollTop = top
    fireEvent.scroll(viewport)
    await new Promise(resolve => requestAnimationFrame(resolve))
  })
}
async function resize() {
  await act(async () => {
    for (const callback of observers) callback([], {} as ResizeObserver)
    await new Promise(resolve => requestAnimationFrame(resolve))
  })
}

test("mounts a bounded window, reaches the end and keeps the full scroll height", async () => {
  const view = show()
  expect(view.container.querySelector('[data-slot="virtual-thread-rows"]')).toHaveStyle({ height: "31998px" })
  expect(view.container.querySelectorAll("[data-session-id]").length).toBeLessThan(30)
  expect(view.queryByText("Chat 500")).toBeNull()
  await scroll(500 * 32)
  expect(view.getByText("Chat 500")).toBeInTheDocument()
  expect(view.queryByText("Chat 10")).toBeNull()
  expect(view.container.querySelectorAll("[data-session-id]").length).toBeLessThan(30)
  await scroll(990 * 32)
  expect(view.getByText("Chat 998")).toBeInTheDocument()
})

test("recomputes the window when the viewport resizes or an earlier group moves the list", async () => {
  const view = show()
  await scroll(50 * 32)
  expect(view.getByText("Chat 50")).toBeInTheDocument()
  height = 640
  await resize()
  expect(view.getByText("Chat 69")).toBeInTheDocument()
  offset = 100 * 32
  await resize()
  // Entire group is now below the viewport; only keyboard entry points remain.
  expect(view.container.querySelectorAll("[data-session-id]")).toHaveLength(2)
  offset = 0
  await resize()
  expect(view.getByText("Chat 50")).toBeInTheDocument()
})

test("retains keyboard focus and its next and previous rows outside the visible window", async () => {
  const view = show()
  const button = view.getByText("Chat 10")
  await act(async () => button.focus())
  await scroll(500 * 32)
  expect(button).toHaveFocus()
  expect(view.getByText("Chat 9")).toBeInTheDocument()
  expect(view.getByText("Chat 11")).toBeInTheDocument()
  await act(async () => button.blur())
  expect(view.queryByText("Chat 10")).toBeNull()
})

function PinnedCard() {
  const pin = useNavigationHoverCardPin()
  const close = useNavigationHoverCardClose()
  useEffect(() => {
    pin(true)
  }, [pin])
  return (
    <>
      <input aria-label="Rename draft" defaultValue="Unsubmitted title" />
      <button type="button" onClick={close}>
        Close card
      </button>
    </>
  )
}

test("an open pinned session card and its draft survive scrolling out of view", async () => {
  const view = render(
    <VirtualThreadRows
      threads={entries}
      viewport={viewport}
      renderRow={(thread, onOpenChange) => (
        <NavigationSessionItem
          title={thread.title}
          data-session-id={thread.sessionId}
          role="button"
          tabIndex={0}
          onHoverCardOpenChange={onOpenChange}
          hoverCard={<PinnedCard />}
        />
      )}
    />,
    { container: viewport, baseElement: document.body }
  )
  const trigger = view.getByRole("button", { name: "Chat 10" })
  fireEvent.pointerEnter(trigger, { pointerType: "mouse" })
  fireEvent.mouseEnter(trigger)
  fireEvent.mouseMove(trigger)
  const input = await view.findByLabelText("Rename draft", {}, { timeout: 2000 })
  fireEvent.change(input, { target: { value: "Keep this draft" } })
  await scroll(500 * 32)
  expect(input).toHaveValue("Keep this draft")
  expect(input).toBeInTheDocument()
  expect(view.getByText("Chat 10")).toBeInTheDocument()
  expect(view.container.querySelectorAll("[data-session-id]").length).toBeLessThan(30)
  fireEvent.click(view.getByRole("button", { name: "Close card" }))
  await waitFor(() => expect(view.queryByText("Chat 10")).toBeNull())
})
