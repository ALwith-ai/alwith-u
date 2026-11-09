import { createSession, type Session } from "@alwith/module-chat/client"
import { drafts, useComposerPrediction } from "@alwith/module-chat/conversation"
import { act, fireEvent, render, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { useStore } from "zustand"

import { client } from "@/lib/client"
import { initI18n } from "@/lib/i18n"

import { predictionPreference } from "../composer/prediction-preference"
import { ChatTimelineHost, Composer } from "./timeline-host"

await initI18n("en")
const original = client.state
beforeEach(() => {
  predictionPreference.setState({ enabled: true })
  client.store.setState({
    agent: { protocolVersion: 2, info: { name: "fake", version: "1" }, capabilities: {} }
  })
})
afterEach(() => {
  predictionPreference.setState({ enabled: true })
  vi.restoreAllMocks()
  client.store.setState(original, true)
  drafts.clear()
})
function completed(id = "s1", turn = "t1"): Session {
  return {
    ...createSession(id, "/tmp"),
    attached: true,
    lastStopReason: "end_turn",
    items: [
      {
        kind: "user",
        id: `message-${turn}`,
        at: 1,
        replayed: false,
        echo: null,
        content: [{ type: "text", text: "Hello" }],
        _meta: { codex: { turnId: turn } }
      }
    ]
  }
}
/** The agent's `promptSuggestions` session metadata; `null` is the cleared list it sends when a prompt starts. */
function predicted(session: Session, text: string | null = "Run the tests") {
  return { ...session, _meta: { promptSuggestions: { suggestions: text === null ? [] : [{ text }] } } }
}
/** The composer's prediction with U's preference, as the U composer wires it. */
function usePrediction(session: Session, available: boolean, hasDraft: boolean) {
  return useComposerPrediction(
    session,
    available,
    hasDraft,
    useStore(predictionPreference, (state) => state.enabled)
  )
}

test("Tab accepts an editable draft without sending; Shift-Tab and IME leave it alone", async () => {
  const session = completed()
  const submit = vi.fn()
  const view = render(<Composer session={predicted(session)} onSubmit={submit} />)
  const input = view.getByRole("textbox")
  expect(input).toHaveAttribute("placeholder", "Run the tests")
  fireEvent.keyDown(input, { key: "Tab", shiftKey: true })
  expect(input).toHaveValue("")
  fireEvent.keyDown(input, { key: "Tab", isComposing: true })
  expect(input).toHaveValue("")
  fireEvent.keyDown(input, { key: "Tab" })
  expect(input).toHaveValue("Run the tests")
  expect(submit).not.toHaveBeenCalled()
  fireEvent.change(input, { target: { value: "Run only unit tests" } })
  expect(input).toHaveValue("Run only unit tests")
  fireEvent.change(input, { target: { value: "" } })
  expect(input).toHaveAttribute("placeholder", "Run the tests")
  fireEvent.keyDown(input, { key: "Tab" })
  expect(input).toHaveValue("Run the tests")
  expect(view.queryByText(/Tab to accept/)).not.toBeInTheDocument()
  fireEvent.keyDown(input, { key: "Enter" })
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(1))
  fireEvent.change(input, { target: { value: "" } })
  await waitFor(() => expect(input).not.toHaveAttribute("placeholder", "Run the tests"))
})

test("typing, clearing and Escape preserve a prediction for repeated Tab acceptance", () => {
  const session = completed()
  const view = render(<Composer session={predicted(session)} />)
  const input = view.getByRole("textbox")
  fireEvent.keyDown(input, { key: "Escape" })
  expect(input).toHaveAttribute("placeholder", "Run the tests")
  view.unmount()
  drafts.clear()
  const next = render(<Composer session={predicted(session)} />)
  fireEvent.change(next.getByRole("textbox"), { target: { value: "My message" } })
  fireEvent.change(next.getByRole("textbox"), { target: { value: "" } })
  expect(next.getByRole("textbox")).toHaveAttribute("placeholder", "Run the tests")
})

test("running turns, drafts, replayed history, read-only sessions and a cleared list stay hidden", () => {
  const session = completed()
  const view = renderHook(
    ({ session, available, draft }) => usePrediction(session, available, draft),
    { wrapper: ChatTimelineHost, initialProps: { session, available: true, draft: false } }
  )
  expect(view.result.current.text).toBeNull()
  view.rerender({ session: predicted(session), available: true, draft: false })
  expect(view.result.current.text).toBe("Run the tests")
  view.rerender({ session: { ...predicted(session), state: "running" }, available: true, draft: false })
  expect(view.result.current.text).toBeNull()
  view.rerender({ session: predicted(session), available: true, draft: true })
  expect(view.result.current.text).toBeNull()
  const replay = predicted(completed("history", "t3"))
  view.rerender({
    session: { ...replay, items: replay.items.map((item) => ({ ...item, replayed: true })) },
    available: true,
    draft: false
  })
  expect(view.result.current.text).toBeNull()
  view.rerender({ session: { ...predicted(completed("readonly", "t4")), readOnly: true }, available: false, draft: false })
  expect(view.result.current.text).toBeNull()
  view.rerender({ session: predicted(session, null), available: true, draft: false })
  expect(view.result.current.text).toBeNull()
})

test("the submitted draft cannot dismiss a new turn's prediction before the input clears", () => {
  const running: Session = { ...completed(), state: "running", lastStopReason: null }
  const view = renderHook(({ session, available, hasDraft }) => usePrediction(session, available, hasDraft), {
    wrapper: ChatTimelineHost,
    initialProps: { session: running, available: false, hasDraft: true }
  })
  view.rerender({ session: completed(), available: false, hasDraft: true })
  view.rerender({ session: predicted(completed()), available: true, hasDraft: false })
  expect(view.result.current.text).toBe("Run the tests")
})

test("steering does not invalidate the prediction for the still-running native turn", () => {
  const session: Session = { ...completed(), state: "running", lastStopReason: null }
  const view = renderHook(({ session }: { session: Session }) => usePrediction(session, true, false), {
    wrapper: ChatTimelineHost,
    initialProps: { session }
  })
  act(() => view.result.current.invalidate())
  view.rerender({ session: predicted(completed()) })
  expect(view.result.current.text).toBe("Run the tests")
})

test("an invalidated prediction stays hidden until the next turn publishes a new one", () => {
  const first = predicted(completed())
  const view = renderHook(({ session }: { session: Session }) => usePrediction(session, true, false), {
    wrapper: ChatTimelineHost,
    initialProps: { session: first }
  })
  expect(view.result.current.text).toBe("Run the tests")
  act(() => view.result.current.invalidate())
  expect(view.result.current.text).toBeNull()
  view.rerender({ session: predicted(completed("s1", "t2"), "Check the new model") })
  expect(view.result.current.text).toBe("Check the new model")
})

test("disabling predictions hides the suggestion until enabled again", () => {
  predictionPreference.setState({ enabled: false })
  const session = predicted(completed())
  const view = renderHook(({ session }) => usePrediction(session, true, false), {
    wrapper: ChatTimelineHost,
    initialProps: { session }
  })
  expect(view.result.current.text).toBeNull()
  act(() => predictionPreference.setState({ enabled: true }))
  expect(view.result.current.text).toBe("Run the tests")
  act(() => predictionPreference.setState({ enabled: false }))
  expect(view.result.current.text).toBeNull()
})

test.each(["idle", "running"] as const)(
  "clears %s input before the receipt and preserves the next draft",
  async (state) => {
    const receipt = Promise.withResolvers<void>()
    const submit = vi.fn(() => receipt.promise)
    const session = { ...completed(), state }
    const view = render(<Composer session={session} onSubmit={submit} />)
    try {
      const input = view.getByRole("textbox")
      fireEvent.change(input, { target: { value: "first request" } })
      fireEvent.keyDown(input, { key: "Enter" })
      await waitFor(() => {
        expect(submit).toHaveBeenCalledTimes(1)
        expect(input).toHaveValue("")
      })
      expect(drafts.get("s1")?.text).toBe("")
      view.rerender(<Composer session={{ ...session, clock: session.clock + 1 }} onSubmit={submit} />)
      expect(input).toHaveValue("")
      fireEvent.change(input, { target: { value: "next request" } })
      await act(() => Promise.try(() => receipt.resolve()))
      expect(input).toHaveValue("next request")
      expect(drafts.get("s1")?.text).toBe("next request")
    } finally {
      view.unmount()
    }
  }
)
