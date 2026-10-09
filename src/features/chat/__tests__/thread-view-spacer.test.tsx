import { addPrompt, applyUpdate, createSession } from "@alwith/api"
import { act, cleanup, render, waitFor } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"
import { ThemeProvider } from "@/components/theme-provider"
import { initI18n } from "@/lib/i18n"

vi.mock("@tauri-apps/plugin-log", () => ({ info: async () => {} }))
const { ThreadView } = await import("../thread-view")
const { navigationSoundStore } = await import("../codex/navigation-sound-store")
await initI18n("en")
navigationSoundStore.setState({ soundMode: "none" })
const originalRect = HTMLElement.prototype.getBoundingClientRect
const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")
const originalResizeObserver = globalThis.ResizeObserver
afterEach(async () => {
  await act(async () => cleanup())
  globalThis.ResizeObserver = originalResizeObserver
  HTMLElement.prototype.getBoundingClientRect = originalRect
  if (originalOffsetHeight) Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeight)
})

test("the latest turn stays anchored through growth and loading-placeholder shrink, until the user scrolls", async () => {
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
      <ThreadView session={first} />
    </ThemeProvider>
  )
  const viewport = view.getByRole("log")
  let latestHeight = 80
  let position = 0
  const spacer = viewport.querySelector<HTMLElement>("[data-turn-anchor-spacer]")
  if (spacer === null) throw new Error("Test spacer is missing")
  Object.defineProperties(viewport, {
    clientHeight: { configurable: true, value: 500 },
    scrollHeight: { configurable: true, get: () => 412 + latestHeight + 24 + Number.parseFloat(spacer.style.height) },
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
      } as DOMRect
    return originalRect.call(this)
  }
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      const key = this.getAttribute("data-turn-key")
      return key === null ? 0 : key.endsWith("second") ? latestHeight : 400
    }
  })
  view.rerender(
    <ThemeProvider>
      <ThreadView session={second} />
    </ThemeProvider>
  )
  await waitFor(() => expect(viewport.scrollTop).toBe(348))
  const latest = viewport.querySelector<HTMLElement>('[data-codex-turn="turn:user:second"]')
  if (latest === null) throw new Error("Test latest turn is missing")
  const observer = observers.find(observer => observer.targets.has(latest))
  if (observer === undefined) throw new Error("Latest turn resize observer is missing")
  const resize = (height: number) =>
    act(() => {
      latestHeight = height
      observer.notify()
    })
  resize(120)
  expect(spacer.style.height).toBe("292px")
  expect(latest.getBoundingClientRect().top).toBe(64)
  resize(60)
  expect(spacer.style.height).toBe("352px")
  expect(latest.getBoundingClientRect().top).toBe(64)
  act(() => {
    viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: -148 }))
    viewport.scrollTop = 200
    viewport.dispatchEvent(new Event("scroll"))
  })
  resize(80)
  expect(viewport.scrollTop).toBe(200)
  resize(40)
  expect(spacer.style.height).toBe("332px")
  expect(viewport.scrollTop).toBe(200)
})

test("completed answer releases the temporary turn anchor space", async () => {
  const first = applyUpdate(
    addPrompt(createSession("anchor-space", "/tmp"), [{ type: "text", text: "first" }], "first"),
    { sessionUpdate: "state_update", state: "idle" } as never
  )
  const second = addPrompt(first, [{ type: "text", text: "second" }], "second")
  const running = applyUpdate(second, { sessionUpdate: "state_update", state: "running" } as never)
  const view = render(
    <ThemeProvider>
      <ThreadView session={first} />
    </ThemeProvider>
  )
  const viewport = view.getByRole("log")
  Object.defineProperties(viewport, {
    clientHeight: { configurable: true, value: 500 },
    scrollHeight: { configurable: true, value: 300 },
    scrollTo: { configurable: true, value: () => {} }
  })
  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.hasAttribute("data-codex-turn")) return { ...originalRect.call(this), top: 400 } as DOMRect
    return originalRect.call(this)
  }
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      return this.hasAttribute("data-turn-key") ? 80 : 0
    }
  })
  await waitFor(() => expect(viewport.querySelectorAll("[data-codex-turn]")).toHaveLength(1))
  view.rerender(
    <ThemeProvider>
      <ThreadView session={running} />
    </ThemeProvider>
  )
  const spacer = viewport.querySelector<HTMLElement>("[data-turn-anchor-spacer]")
  expect(spacer).not.toBeNull()
  await waitFor(() => expect(Number.parseFloat(spacer?.style.height ?? "0")).toBeGreaterThan(0))

  const completed = applyUpdate(running, { sessionUpdate: "state_update", state: "idle" } as never)
  view.rerender(
    <ThemeProvider>
      <ThreadView session={completed} />
    </ThemeProvider>
  )
  expect(spacer?.style.height).toBe("0px")
})

test("layout compensation near the bottom does not resume following while reading history", () => {
  const session = applyUpdate(
    addPrompt(createSession("scroll-intent", "/tmp"), [{ type: "text", text: "question" }], "user"),
    { sessionUpdate: "state_update", state: "running" } as never
  )
  const view = render(
    <ThemeProvider>
      <ThreadView session={session} />
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
  act(() => viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: -400 })))
  scroll(600)
  const button = view.getByRole("button", { name: "Scroll to bottom" })
  expect(button.classList.contains("codex-scroll-to-bottom-hidden")).toBe(false)
  // Resize/layout correction, with no new downward user gesture.
  scroll(900)
  expect(button.classList.contains("codex-scroll-to-bottom-hidden")).toBe(false)
})
