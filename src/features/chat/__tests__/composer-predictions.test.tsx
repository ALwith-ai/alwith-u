import { drafts, useComposerPrediction } from "@alwith/module-chat/conversation"
import { createSession, type Session } from "@nyssance/codex-acp-v2/client"
import { act, fireEvent, render, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { useStore } from "zustand"

import { client } from "@/lib/client"
import { initI18n } from "@/lib/i18n"
import { mockOf } from "@/test/mock-of"

import { predictionPreference } from "../composer/prediction-preference"
import { ChatTimelineHost, Composer } from "./timeline-host"

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
  const view = render(<Composer session={session} onSubmit={submit} />)
  await waitFor(() => expect(mockOf(client, "requestPrediction")).toHaveBeenCalledWith("s1", "t1"))
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
  expect(mockOf(client, "requestPrediction")).toHaveBeenCalledTimes(1)
  expect(view.queryByText(/Tab to accept/)).not.toBeInTheDocument()
  fireEvent.keyDown(input, { key: "Enter" })
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(1))
  fireEvent.change(input, { target: { value: "" } })
  await waitFor(() => expect(input).not.toHaveAttribute("placeholder", "Run the tests"))
})

test("typing, clearing and Escape preserve a prediction for repeated Tab acceptance", () => {
  return Promise.try(() => {
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
})

test("stale turns, running, drafts, replay, unsupported agents and unavailable results stay hidden", () => {
  const session = completed()
  const view = renderHook(({ session, draft }) => usePrediction(session, true, draft), {
    wrapper: ChatTimelineHost,
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
  expect(mockOf(client, "requestPrediction")).toHaveBeenCalledTimes(1)
})

test("request failures are visible without affecting the conversation", async () => {
  mockOf(client, "requestPrediction").mockRejectedValue(new Error("Account is not eligible"))
  const session = completed()
  const view = renderHook(() => usePrediction(session, true, false), { wrapper: ChatTimelineHost })
  await waitFor(() => expect(view.result.current.error).toBe("Account is not eligible"))
  expect(session.state).toBe("idle")
})

test("late results from another turn or a changed model never become a draft", () => {
  const first = completed()
  const view = renderHook(({ session }) => usePrediction(session, true, false), {
    wrapper: ChatTimelineHost,
    initialProps: { session: first }
  })
  const second = completed("s1", "t2")
  view.rerender({ session: predicted(second, "t1") })
  expect(view.result.current.text).toBeNull()
  view.rerender({ session: predicted(second, "t2") })
  expect(view.result.current.text).toBe("Run the tests")
  const changed: Session = {
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
  view.rerender({ session: changed })
  expect(view.result.current.text).toBeNull()
  expect(mockOf(client, "requestPrediction")).toHaveBeenCalledTimes(3)
  view.rerender({ session: { ...changed, clock: changed.clock + 1 } })
  expect(view.result.current.text).toBeNull()
  view.rerender({ session: predicted(changed, "t2", "Check with the new model") })
  expect(view.result.current.text).toBe("Check with the new model")
})

test("null and failed results clear the suggestion; history and read-only sessions do not request", () => {
  const session = completed()
  const view = renderHook(({ session, available }) => usePrediction(session, available, false), {
    wrapper: ChatTimelineHost,
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
  expect(mockOf(client, "requestPrediction")).toHaveBeenCalledTimes(1)
})

test("the submitted draft cannot dismiss a new turn's prediction before the input clears", () => {
  const running: Session = { ...completed(), state: "running", lastStopReason: null }
  const view = renderHook(({ session, available, hasDraft }) => usePrediction(session, available, hasDraft), {
    wrapper: ChatTimelineHost,
    initialProps: { session: running, available: false, hasDraft: true }
  })
  view.rerender({ session: completed(), available: false, hasDraft: true })
  view.rerender({ session: completed(), available: true, hasDraft: false })
  expect(mockOf(client, "requestPrediction")).toHaveBeenCalledWith("s1", "t1")
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
  view.rerender({ session: completed() })
  expect(mockOf(client, "requestPrediction")).toHaveBeenCalledWith("s1", "t1")
  view.rerender({ session: predicted(completed()) })
  expect(view.result.current.text).toBe("Run the tests")
})

test("catalog labels and choices can refresh without hiding an existing prediction", () => {
  const session: Session = {
    ...completed(),
    configOptions: [
      {
        configId: "model",
        category: "model",
        name: "Model",
        type: "select",
        currentValue: "same",
        options: [{ value: "same", name: "Same" }]
      }
    ]
  }
  const view = renderHook(({ session }) => usePrediction(session, true, false), {
    wrapper: ChatTimelineHost,
    initialProps: { session }
  })
  view.rerender({ session: predicted(session) })
  expect(view.result.current.text).toBe("Run the tests")
  view.rerender({
    session: {
      ...predicted(session),
      configOptions: [
        {
          ...session.configOptions[0],
          name: "Refreshed model label"
        }
      ]
    }
  })
  expect(view.result.current.text).toBe("Run the tests")
  expect(mockOf(client, "requestPrediction")).toHaveBeenCalledTimes(1)
})

test("disabling predictions hides results and prevents requests until enabled", () => {
  predictionPreference.setState({ enabled: false })
  const session = completed()
  const view = renderHook(({ session }) => usePrediction(session, true, false), {
    wrapper: ChatTimelineHost,
    initialProps: { session }
  })
  expect(mockOf(client, "requestPrediction")).not.toHaveBeenCalled()
  act(() => predictionPreference.setState({ enabled: true }))
  expect(mockOf(client, "requestPrediction")).toHaveBeenCalledTimes(1)
  view.rerender({ session: predicted(session) })
  expect(view.result.current.text).toBe("Run the tests")
  act(() => predictionPreference.setState({ enabled: false }))
  expect(view.result.current.text).toBeNull()
  act(() => predictionPreference.setState({ enabled: true }))
  expect(view.result.current.text).toBe("Run the tests")
  expect(mockOf(client, "requestPrediction")).toHaveBeenCalledTimes(1)
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

test.each([
  ["model", "gateway:deepseek:deepseek-flash", "gpt-6-astra"],
  ["collaboration_mode", "plan", "default"]
])(
  "%s changes stop unsupported prediction requests and hide stale suggestions",
  async (configId, unavailable, native) => {
    const session = completed()
    const configured = (value: string): Session => ({
      ...session,
      configOptions: [
        {
          configId,
          name: configId,
          type: "select",
          currentValue: value,
          options: [
            { value: unavailable, name: unavailable },
            { value: native, name: native }
          ]
        }
      ]
    })
    const view = render(<Composer session={configured(unavailable)} />)
    expect(mockOf(client, "requestPrediction")).not.toHaveBeenCalled()
    view.rerender(<Composer session={configured(native)} />)
    await waitFor(() => expect(mockOf(client, "requestPrediction")).toHaveBeenCalledOnce())
    view.rerender(<Composer session={predicted(configured(native))} />)
    expect(view.getByRole("textbox")).toHaveAttribute("placeholder", "Run the tests")
    view.rerender(<Composer session={predicted(configured(unavailable))} />)
    expect(view.getByRole("textbox")).not.toHaveAttribute("placeholder", "Run the tests")
    expect(mockOf(client, "requestPrediction")).toHaveBeenCalledOnce()
  }
)

test("prediction failures stay silent and leave the composer usable", async () => {
  mockOf(client, "requestPrediction").mockRejectedValueOnce(new Error("Prediction backend unavailable"))
  const view = render(<Composer session={completed()} />)
  await waitFor(() => expect(mockOf(client, "requestPrediction")).toHaveBeenCalledOnce())
  await act(async () => {
    await Promise.resolve()
  })
  expect(view.queryByText("Input suggestion unavailable")).not.toBeInTheDocument()
  expect(view.queryByTitle("Prediction backend unavailable")).not.toBeInTheDocument()
  fireEvent.change(view.getByRole("textbox"), { target: { value: "Continue manually" } })
  expect(view.getByRole("button", { name: "Send" })).toBeEnabled()
})
