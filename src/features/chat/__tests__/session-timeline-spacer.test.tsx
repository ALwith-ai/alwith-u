import { addPrompt, applyUpdate, createSession } from "@alwith/api"
import { act, cleanup, render, waitFor } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

import { ThemeProvider } from "@/components/theme-provider"
import { initI18n } from "@/lib/i18n"

vi.mock("@tauri-apps/plugin-log", () => ({ info: async () => {} }))
const { ChatTimeline: SessionTimeline } = await import("./timeline-host")
const { navigationSoundStore } = await import("../codex/navigation-sound-store")
await initI18n("en")
navigationSoundStore.setState({ soundMode: "none" })
const originalRect = Reflect.get(HTMLElement.prototype, "getBoundingClientRect")
const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")
const originalResizeObserver = globalThis.ResizeObserver
afterEach(async () => {
  await act(() => Promise.try(() => cleanup()))
  globalThis.ResizeObserver = originalResizeObserver
  HTMLElement.prototype.getBoundingClientRect = originalRect
  if (originalOffsetHeight) Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeight)
})

test("a steer does not create a thinking placeholder while the original output is streaming", async () => {
  let session = applyUpdate(createSession("steering-display", "/tmp"), {
    sessionUpdate: "user_message",
    messageId: "first",
    content: [{ type: "text", text: "Start" }],
    _meta: { codex: { turnId: "native" } }
  } as never)
  session = applyUpdate(session, { sessionUpdate: "state_update", state: "running" } as never)
  const output = (text: string) => ({
    sessionUpdate: "agent_message_chunk",
    messageId: "output",
    content: { type: "text", text },
    _meta: { codex: { turnId: "native", phase: "commentary" } }
  })
  session = applyUpdate(session, output("Still working") as never)
  session = addPrompt(session, [{ type: "text", text: "Also check this" }], "steer")
  const view = render(
    <ThemeProvider>
      <SessionTimeline session={session} />
    </ThemeProvider>
  )
  await waitFor(() => expect(view.getByText("Also check this")).toBeInTheDocument())
  expect(view.queryByText("Thinking")).not.toBeInTheDocument()
  expect(view.container.querySelector('[data-codex-turn="turn:user:steer"] .codex-pending-message')).toBeNull()
  session = applyUpdate(session, output("Still working and updating") as never)
  view.rerender(
    <ThemeProvider>
      <SessionTimeline session={session} />
    </ThemeProvider>
  )
  await waitFor(() => expect(view.getByText("Still working and updating")).toBeInTheDocument())
  expect(view.queryByText("Thinking")).not.toBeInTheDocument()
})

test("new turns follow their real content through growth and placeholder shrink, until the user scrolls", async () => {
  const observers: { targets: Set<Element>; notify: () => void }[] = []
  class Observer implements ResizeObserver {
    readonly targets = new Set<Element>()
    constructor(callback: ResizeObserverCallback) {
      observers.push({ targets: this.targets, notify: () => callback([], this) })
    }
    observe(target: Element) {
      this.targets.add(target)
    }
    unobserve(target: Element) {
      this.targets.delete(target)
    }
    disconnect() {
      this.targets.clear()
    }
  }
  globalThis.ResizeObserver = Observer
  const first = applyUpdate(
    addPrompt(createSession("anchor-resize", "/tmp"), [{ type: "text", text: "first" }], "first"),
    { sessionUpdate: "state_update", state: "idle" } as never
  )
  const second = applyUpdate(addPrompt(first, [{ type: "text", text: "second" }], "second"), {
    sessionUpdate: "state_update",
    state: "running"
  } as never)
  const view = render(
    <ThemeProvider>
      <SessionTimeline session={first} />
    </ThemeProvider>
  )
  const viewport = view.getByRole("log")
  let latestHeight = 80
  let position = 0
  Object.defineProperties(viewport, {
    clientHeight: { configurable: true, value: 500 },
    scrollHeight: {
      configurable: true,
      get: () =>
        Math.max(
          500,
          412 +
            latestHeight +
            24 +
            Number.parseFloat(viewport.querySelector<HTMLElement>("[data-turn-anchor-spacer]")?.style.height ?? "0")
        )
    },
    scrollTop: {
      configurable: true,
      get() {
        position = Math.min(position, viewport.scrollHeight - 500)
        return position
      },
      set(value: number) {
        position = Math.max(0, Math.min(value, viewport.scrollHeight - 500))
      }
    },
    scrollTo: {
      configurable: true,
      value: ({ top }: ScrollToOptions) => {
        if (top === undefined) throw new Error("Test target is missing")
        viewport.scrollTop = top
      }
    }
  })
  HTMLElement.prototype.getBoundingClientRect = function () {
    const key = this.getAttribute("data-codex-turn") ?? this.getAttribute("data-turn-key")
    if (key !== null)
      return {
        ...originalRect.call(this),
        top: (key.endsWith("second") ? 412 : 0) - viewport.scrollTop,
        height: key.endsWith("second") ? latestHeight : 400
      }
    return originalRect.call(this)
  }
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      const key = this.getAttribute("data-turn-key")
      return key === null ? 0 : key.endsWith("second") ? latestHeight : 400
    }
  })
  view.rerender(
    <ThemeProvider>
      <SessionTimeline session={second} />
    </ThemeProvider>
  )
  await waitFor(() => expect(viewport.scrollTop).toBe(16))
  const latest = viewport.querySelector<HTMLElement>('[data-codex-turn="turn:user:second"]')
  if (latest === null) throw new Error("Test latest turn is missing")
  const observer = observers.find((observer) => observer.targets.has(latest))
  if (observer === undefined) throw new Error("Latest turn resize observer is missing")
  const resize = (height: number) =>
    act(() => {
      latestHeight = height
      observer.notify()
    })
  resize(120)
  await waitFor(() => expect(viewport.scrollTop).toBe(56))
  resize(60)
  await waitFor(() => expect(viewport.scrollTop).toBe(0))
  resize(600)
  await waitFor(() => expect(viewport.scrollTop).toBe(536))
  act(() => {
    viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: -148 }))
    viewport.scrollTop = 200
    viewport.dispatchEvent(new Event("scroll"))
  })
  resize(680)
  expect(viewport.scrollTop).toBe(200)
  resize(400)
  expect(viewport.scrollTop).toBe(200)
})

test("a short reply received together with completion never leaves extra scroll range", async () => {
  const first = applyUpdate(
    addPrompt(createSession("anchor-space", "/tmp"), [{ type: "text", text: "first" }], "first"),
    { sessionUpdate: "state_update", state: "idle" } as never
  )
  const second = addPrompt(first, [{ type: "text", text: "second" }], "second")
  const completed = applyUpdate(second, { sessionUpdate: "state_update", state: "idle" } as never)
  const view = render(
    <ThemeProvider>
      <SessionTimeline session={first} />
    </ThemeProvider>
  )
  const viewport = view.getByRole("log")
  Object.defineProperties(viewport, {
    clientHeight: { configurable: true, value: 500 },
    scrollHeight: {
      configurable: true,
      get: () =>
        500 + Number.parseFloat(viewport.querySelector<HTMLElement>("[data-turn-anchor-spacer]")?.style.height ?? "0")
    },
    scrollTo: { configurable: true, value: () => {} }
  })
  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.hasAttribute("data-codex-turn")) return { ...originalRect.call(this), top: 400 }
    return originalRect.call(this)
  }
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute("data-turn-key") ? 80 : 0
    }
  })
  await waitFor(() => expect(viewport.querySelectorAll("[data-codex-turn]")).toHaveLength(1))
  view.rerender(
    <ThemeProvider>
      <SessionTimeline session={completed} />
    </ThemeProvider>
  )
  // Flush deferred positioning as well as the initial render; the completed
  // response used to schedule a new anchor after completion had already cleared it.
  await act(async () => {
    for (let frame = 0; frame < 8; frame++) await new Promise(requestAnimationFrame)
  })
  expect(viewport.scrollHeight).toBe(viewport.clientHeight)
})

test("layout compensation near the bottom does not resume following while reading history", () => {
  const session = applyUpdate(
    addPrompt(createSession("scroll-intent", "/tmp"), [{ type: "text", text: "question" }], "user"),
    { sessionUpdate: "state_update", state: "running" } as never
  )
  const view = render(
    <ThemeProvider>
      <SessionTimeline session={session} />
    </ThemeProvider>
  )
  const viewport = view.getByRole("log")
  Object.defineProperties(viewport, {
    clientHeight: { configurable: true, value: 600 },
    scrollHeight: { configurable: true, value: 1600 }
  })
  const scroll = (top: number) =>
    act(() => {
      viewport.scrollTop = top
      viewport.dispatchEvent(new Event("scroll"))
    })
  scroll(1000)
  void act(() => viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: -400 })))
  scroll(600)
  const button = view.getByRole("button", { name: "Scroll to bottom" })
  expect(button.classList.contains("codex-scroll-to-bottom-hidden")).toBe(false)
  // Resize/layout correction, with no new downward user gesture.
  scroll(900)
  expect(button.classList.contains("codex-scroll-to-bottom-hidden")).toBe(false)
})
