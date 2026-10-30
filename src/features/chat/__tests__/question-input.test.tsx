import { AsyncQuestionCard, type QuestionDraft } from "@alwith/module-chat/async-question-card"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { afterEach, expect, test, vi } from "vitest"

const question = { title: "Your answer?", options: ["First"] }
const translate = (key: string) => key
function Input({
  submit,
  status = "pending",
  text = ""
}: {
  submit: () => void
  status?: "pending" | "submitting" | "unavailable"
  text?: string
}) {
  const [draft, setDraft] = useState<QuestionDraft>({ selected: null, text })
  return (
    <AsyncQuestionCard
      question={question}
      draft={draft}
      status={status}
      onChange={setDraft}
      onSubmit={submit}
      onSkip={() => {}}
      t={translate}
    />
  )
}
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test("the question input starts at one row and Enter submits its current answer", () => {
  const submit = vi.fn()
  render(<Input submit={submit} />)
  const input = screen.getByRole("textbox")
  expect(input).toHaveAttribute("rows", "1")
  expect(input).toHaveClass("min-h-0", "resize-none")
  fireEvent.change(input, { target: { value: "My answer" } })
  expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(false)
  expect(submit).toHaveBeenCalledTimes(1)
})

test("Shift+Enter retains the browser newline and whitespace cannot submit", () => {
  const submit = vi.fn()
  render(<Input submit={submit} />)
  const input = screen.getByRole("textbox")
  fireEvent.change(input, { target: { value: "   " } })
  fireEvent.keyDown(input, { key: "Enter" })
  expect(submit).not.toHaveBeenCalled()
  fireEvent.change(input, { target: { value: "two lines" } })
  expect(fireEvent.keyDown(input, { key: "Enter", shiftKey: true })).toBe(true)
  expect(submit).not.toHaveBeenCalled()
})

test("IME confirmation and WebKit's following Enter do not submit", () => {
  let confirm!: FrameRequestCallback
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    confirm = callback
    return 1
  })
  vi.stubGlobal("cancelAnimationFrame", vi.fn())
  const submit = vi.fn()
  render(<Input submit={submit} text="中文回答" />)
  const input = screen.getByRole("textbox")
  fireEvent.compositionStart(input)
  fireEvent.keyDown(input, { key: "Enter" })
  fireEvent.compositionEnd(input)
  fireEvent.keyDown(input, { key: "Enter" })
  expect(submit).not.toHaveBeenCalled()
  act(() => confirm(0))
  fireEvent.keyDown(input, { key: "Enter", isComposing: true })
  fireEvent.keyDown(input, { key: "Enter", keyCode: 229 })
  expect(submit).not.toHaveBeenCalled()
  fireEvent.keyDown(input, { key: "Enter" })
  expect(submit).toHaveBeenCalledTimes(1)
})

test.each(["submitting", "unavailable"] as const)("%s questions cannot submit from the input", (status) => {
  const submit = vi.fn()
  render(<Input submit={submit} status={status} text="My answer" />)
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" })
  expect(submit).not.toHaveBeenCalled()
})
