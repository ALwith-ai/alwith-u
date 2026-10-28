import { acknowledgePrompt, addPrompt, applyUpdate, createSession } from "@alwith/api"
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

test("a steer preserves one thinking indicator while commentary continues streaming", async () => {
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
  expect(view.getAllByText("Thinking")).toHaveLength(1)
  expect(view.container.querySelector('[data-codex-turn="turn:user:steer"] .codex-pending-message')).toBeNull()
  session = applyUpdate(session, output("Still working and updating") as never)
  view.rerender(
    <ThemeProvider>
      <SessionTimeline session={session} />
    </ThemeProvider>
  )
  await waitFor(() => expect(view.getByText("Still working and updating")).toBeInTheDocument())
  expect(view.getAllByText("Thinking")).toHaveLength(1)
})

test("steering bubbles remain visible when a native turn has no assistant output", async () => {
  let session = createSession("empty-steered-turn", "/tmp")
  for (const id of ["first request", "additional request"])
    session = applyUpdate(session, {
      sessionUpdate: "user_message",
      messageId: id,
      content: [{ type: "text", text: id }],
      _meta: { codex: { turnId: "one-native-turn" } }
    } as never)
  const view = render(
    <ThemeProvider>
      <SessionTimeline session={session} />
    </ThemeProvider>
  )
  await waitFor(() => expect(view.getByText("additional request")).toBeVisible())
  expect(view.getByText("first request")).toBeVisible()
  expect(view.container.querySelectorAll("[data-codex-turn]")).toHaveLength(2)
  expect(view.queryByText("Thinking")).not.toBeInTheDocument()
})

test.each(["commentary", "final_answer"])(
  "%s keeps its start position through steering and completion",
  async (phase) => {
    const meta = { codex: { turnId: "ordering", phase } }
    let session = applyUpdate(createSession(`order-${phase}`, "/tmp"), {
      sessionUpdate: "user_message",
      messageId: "opening",
      content: [{ type: "text", text: "Original request" }],
      _meta: meta
    } as never)
    const update = (value: unknown) => {
      session = applyUpdate(session, value as never)
    }
    update({ sessionUpdate: "state_update", state: "running" })
    // Native item start reserves the slot before any text delta, including a slow first token.
    update({ sessionUpdate: "agent_message", messageId: "answer", content: [{ type: "text", text: "" }], _meta: meta })
    const ui = () => (
      <ThemeProvider>
        <SessionTimeline session={session} />
      </ThemeProvider>
    )
    const view = render(ui())
    session = addPrompt(session, [{ type: "text", text: "Additional request" }], "local-steer")
    view.rerender(ui())
    update({
      sessionUpdate: "agent_message_chunk",
      messageId: "answer",
      content: { type: "text", text: "Original response" },
      _meta: meta
    })
    const verify = async () => {
      view.rerender(ui())
      await waitFor(() => expect(view.getAllByText("Original response")).toHaveLength(1))
      const response = view.getByText("Original response")
      const steer = view.getByText("Additional request")
      expect(response.compareDocumentPosition(steer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      if (phase === "commentary") expect(response.closest(".codex-work-body")).not.toBeNull()
      else expect(response.closest(".codex-work-body")).toBeNull()
      expect(view.container.querySelectorAll("[data-codex-turn]")).toHaveLength(2)
    }
    await verify()
    session = acknowledgePrompt(session, "local-steer", "steer")
    await verify()
    update({
      sessionUpdate: "user_message",
      messageId: "steer",
      content: [{ type: "text", text: "Additional request" }],
      _meta: meta
    })
    await verify()
    update({
      sessionUpdate: "agent_message",
      messageId: "answer",
      content: [{ type: "text", text: "Original response" }],
      _meta: { codex: { ...meta.codex, messageCompleted: true } }
    })
    await verify()
    update({ sessionUpdate: "state_update", state: "idle", stopReason: "end_turn" })
    await verify()
  }
)

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
