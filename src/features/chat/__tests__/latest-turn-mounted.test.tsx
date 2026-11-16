import { addPrompt, applyUpdate, createSession } from "@alwith/module-chat/client"
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

import { ThemeProvider } from "@/components/theme-provider"
import { client } from "@/lib/client"
import { initI18n } from "@/lib/i18n"

vi.mock("@tauri-apps/plugin-log", () => ({ info: async () => {} }))
const { ChatTimeline } = await import("./timeline-host")
await initI18n("en")
const initialState = client.state

afterEach(async () => {
  await act(async () => cleanup())
  client.store.setState(initialState, true)
  vi.unstubAllGlobals()
})

test("a fully loaded long conversation keeps its latest turn mounted", async () => {
  let session = createSession("latest-mounted-long", "/tmp")
  for (let index = 0; index < 120; index++) {
    session = addPrompt(session, [{ type: "text", text: `Question ${index}` }], `prompt-${index}`)
    session = applyUpdate(session, { sessionUpdate: "state_update", state: "idle" } as never)
  }
  const view = render(
    <ThemeProvider>
      <ChatTimeline session={session} />
    </ThemeProvider>
  )
  expect(view.getByText("Question 119")).toBeInTheDocument()
  await act(async () => {})
})

test("observes a loaded turn only while it is mounted in virtual history", async () => {
  const observed = new Set<Element>()
  const ResizeObserverBase = globalThis.ResizeObserver
  vi.stubGlobal(
    "ResizeObserver",
    class extends ResizeObserverBase {
      readonly targets = new Set<Element>()
      override observe(target: Element) {
        this.targets.add(target)
        observed.add(target)
        super.observe(target)
      }
      override unobserve(target: Element) {
        this.targets.delete(target)
        observed.delete(target)
        super.unobserve(target)
      }
      override disconnect() {
        for (const target of this.targets) observed.delete(target)
        this.targets.clear()
        super.disconnect()
      }
    }
  )
  const session = applyUpdate(createSession("latest-mounted-history", "/tmp"), {
    sessionUpdate: "user_message",
    messageId: "older-prompt",
    content: [{ type: "text", text: "Loaded older question" }],
    _meta: { codex: { turnId: "native-0" } }
  })
  client.store.setState({
    historyNavigation: {
      [session.id]: {
        turns: Array.from({ length: 120 }, (_, index) => ({ turnId: `native-${index}` })),
        loadedTurnIds: ["native-0"],
        complete: true,
        loading: false,
        error: null,
        turnErrors: {},
        previews: {}
      }
    }
  })
  const view = render(
    <ThemeProvider>
      <ChatTimeline session={session} />
    </ThemeProvider>
  )
  const viewport = view.getByRole("log")
  expect(view.queryByText("Loaded older question")).not.toBeInTheDocument()
  Object.defineProperties(viewport, {
    clientHeight: { configurable: true, value: 800 },
    scrollHeight: {
      configurable: true,
      get: () => Number.parseFloat(viewport.querySelector<HTMLElement>("[data-codex-timeline]")!.style.height) + 24
    }
  })
  act(() => {
    viewport.scrollTop = 0
    fireEvent.scroll(viewport)
  })
  await waitFor(() => expect(view.getByText("Loaded older question")).toBeInTheDocument())
  const turn = view.getByText("Loaded older question").closest("[data-codex-turn]")!
  await waitFor(() => expect(observed.has(turn)).toBe(true))
  act(() => {
    viewport.scrollTop = viewport.scrollHeight - viewport.clientHeight
    fireEvent.scroll(viewport)
  })
  await waitFor(() => expect(view.queryByText("Loaded older question")).not.toBeInTheDocument())
  await waitFor(() => expect(observed.has(turn)).toBe(false))
  act(() => {
    viewport.scrollTop = 0
    fireEvent.scroll(viewport)
  })
  await waitFor(() => expect(view.getByText("Loaded older question")).toBeInTheDocument())
  const remounted = view.getByText("Loaded older question").closest("[data-codex-turn]")!
  expect(remounted).not.toBe(turn)
  await waitFor(() => expect(observed.has(remounted)).toBe(true))
  view.unmount()
  expect(observed.size).toBe(0)
})
