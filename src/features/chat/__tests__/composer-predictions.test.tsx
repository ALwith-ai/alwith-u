import { createSession, type Session } from "@alwith/api"
import { act, fireEvent, render, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import { client } from "@/lib/client"
import { initI18n } from "@/lib/i18n"

import { Composer } from "../composer"
import { drafts } from "../composer/drafts"
import { predictionPreference } from "../composer/prediction-preference"
import { useComposerPrediction } from "../composer/use-composer-prediction"

await initI18n("en")
const original = client.state
beforeEach(() => {
  predictionPreference.setState({ enabled: true })
  client.store.setState({
    agent: {
      protocolVersion: 2,
      info: { name: "fake", version: "1" },
      capabilities: { _meta: { codex: { composerPredictions: true } } }
    }
  })
  vi.spyOn(client, "requestPrediction").mockResolvedValue()
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
function predicted(session: Session, turn = "t1", text: string | null = "Run the tests") {
  return { ...session, _meta: { codex: { prediction: { sourceTurnId: turn, result: { type: "completed", text } } } } }
}

test("Tab accepts an editable draft without sending; Shift-Tab and IME leave it alone", async () => {
  const session = completed()
  const submit = vi.fn()
  const view = render(<Composer session={session} onSubmit={submit} />)
  await waitFor(() => expect(client.requestPrediction).toHaveBeenCalledWith("s1", "t1"))
  view.rerender(<Composer session={predicted(session)} onSubmit={submit} />)
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
  expect(client.requestPrediction).toHaveBeenCalledTimes(1)
  expect(view.queryByText(/Tab to accept/)).not.toBeInTheDocument()
  fireEvent.keyDown(input, { key: "Enter" })
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(1))
  fireEvent.change(input, { target: { value: "" } })
  await waitFor(() => expect(input).not.toHaveAttribute("placeholder", "Run the tests"))
})

test("typing, clearing and Escape preserve a prediction for repeated Tab acceptance", async () => {
  const session = completed()
  const view = render(<Composer session={session} />)
  view.rerender(<Composer session={predicted(session)} />)
  const input = view.getByRole("textbox")
  fireEvent.keyDown(input, { key: "Escape" })
  expect(input).toHaveAttribute("placeholder", "Run the tests")
  view.unmount()
  drafts.clear()
  const next = render(<Composer session={session} />)
  next.rerender(<Composer session={predicted(session)} />)
  fireEvent.change(next.getByRole("textbox"), { target: { value: "My message" } })
  fireEvent.change(next.getByRole("textbox"), { target: { value: "" } })
  expect(next.getByRole("textbox")).toHaveAttribute("placeholder", "Run the tests")
})

test("stale turns, running, drafts, replay, unsupported agents and unavailable results stay hidden", () => {
  const session = completed()
  const view = renderHook(({ session, draft }) => useComposerPrediction(session, true, draft), {
    initialProps: { session, draft: false }
  })
  view.rerender({ session: predicted(session, "old"), draft: false })
  expect(view.result.current.text).toBeNull()
  view.rerender({ session: predicted(session), draft: false })
  expect(view.result.current.text).toBe("Run the tests")
  view.rerender({ session: { ...predicted(session), state: "running" }, draft: false })
  expect(view.result.current.text).toBeNull()
  view.rerender({ session: predicted(session), draft: true })
  expect(view.result.current.text).toBeNull()
  act(() => client.store.setState({ agent: null }))
  view.rerender({ session: predicted(completed("s2", "t2"), "t2"), draft: false })
  expect(view.result.current.text).toBeNull()
  expect(client.requestPrediction).toHaveBeenCalledTimes(1)
})

test("request failures are visible without affecting the conversation", async () => {
  vi.mocked(client.requestPrediction).mockRejectedValue(new Error("Account is not eligible"))
  const session = completed()
  const view = renderHook(() => useComposerPrediction(session, true, false))
  await waitFor(() => expect(view.result.current.error).toBe("Account is not eligible"))
  expect(session.state).toBe("idle")
})

test("late results from another turn or a changed model never become a draft", () => {
  const first = completed()
  const view = renderHook(({ session }) => useComposerPrediction(session, true, false), {
    initialProps: { session: first }
  })
  const second = completed("s1", "t2")
  view.rerender({ session: predicted(second, "t1") })
  expect(view.result.current.text).toBeNull()
  view.rerender({ session: predicted(second, "t2") })
  expect(view.result.current.text).toBe("Run the tests")
  view.rerender({
    session: {
      ...predicted(second, "t2"),
      configOptions: [
        {
          configId: "model",
          name: "Model",
          type: "select",
          currentValue: "other",
          options: [{ value: "other", name: "Other" }]
        }
      ]
    }
  })
  expect(view.result.current.text).toBeNull()
  expect(client.requestPrediction).toHaveBeenCalledTimes(2)
})

test("null and failed results clear the suggestion; history and read-only sessions do not request", () => {
  const session = completed()
  const view = renderHook(({ session, available }) => useComposerPrediction(session, available, false), {
    initialProps: { session, available: true }
  })
  view.rerender({ session: predicted(session), available: true })
  expect(view.result.current.text).toBe("Run the tests")
  view.rerender({ session: predicted(session, "t1", null), available: true })
  expect(view.result.current.text).toBeNull()
  view.rerender({
    session: { ...session, _meta: { codex: { prediction: { sourceTurnId: "t1", result: { type: "failed" } } } } },
    available: true
  })
  expect(view.result.current.error).toBe("Prediction failed")
  const replay = completed("history", "t3")
  view.rerender({
    session: { ...replay, items: replay.items.map((item) => ({ ...item, replayed: true })) },
    available: true
  })
  view.rerender({ session: { ...completed("readonly", "t4"), readOnly: true }, available: false })
  expect(client.requestPrediction).toHaveBeenCalledTimes(1)
})

test("the submitted draft cannot dismiss a new turn's prediction before the input clears", () => {
  const running = { ...completed(), state: "running" as const, lastStopReason: null }
  const view = renderHook(({ session, available, hasDraft }) => useComposerPrediction(session, available, hasDraft), {
    initialProps: { session: running as Session, available: false, hasDraft: true }
  })
  view.rerender({ session: completed(), available: false, hasDraft: true })
  view.rerender({ session: completed(), available: true, hasDraft: false })
  expect(client.requestPrediction).toHaveBeenCalledWith("s1", "t1")
  view.rerender({ session: predicted(completed()), available: true, hasDraft: false })
  expect(view.result.current.text).toBe("Run the tests")
})

test("disabling predictions hides results and prevents requests until enabled", () => {
  predictionPreference.setState({ enabled: false })
  const session = completed()
  const view = renderHook(({ session }) => useComposerPrediction(session, true, false), {
    initialProps: { session }
  })
  expect(client.requestPrediction).not.toHaveBeenCalled()
  act(() => predictionPreference.setState({ enabled: true }))
  expect(client.requestPrediction).toHaveBeenCalledTimes(1)
  view.rerender({ session: predicted(session) })
  expect(view.result.current.text).toBe("Run the tests")
  act(() => predictionPreference.setState({ enabled: false }))
  expect(view.result.current.text).toBeNull()
  act(() => predictionPreference.setState({ enabled: true }))
  expect(view.result.current.text).toBe("Run the tests")
  expect(client.requestPrediction).toHaveBeenCalledTimes(1)
})
