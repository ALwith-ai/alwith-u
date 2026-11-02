import { createSession, type Session } from "@alwith/module-chat/client"
import { drafts } from "@alwith/module-chat/conversation"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

import { initI18n } from "@/lib/i18n"

import { Composer } from "../../__tests__/timeline-host"

await initI18n("en")
afterEach(() => {
  cleanup()
  drafts.clear()
})

function session(id = "history", texts = ["First prompt", "第二条消息", "Latest prompt"]): Session {
  return {
    ...createSession(id, "/tmp"),
    attached: true,
    items: texts.map((text, index) => ({
      kind: "user",
      id: `message-${index}`,
      at: index,
      replayed: index === 0,
      echo: null,
      _meta: null,
      content: [{ type: "text", text }]
    }))
  }
}
const arrow = (key: "ArrowUp" | "ArrowDown", extra = {}) =>
  fireEvent.keyDown(screen.getByRole("textbox"), { key, ...extra })

test("up recalls sent prompts including replayed messages; down restores the empty draft", () => {
  const submit = vi.fn()
  render(<Composer session={session()} onSubmit={submit} />)
  const input = screen.getByRole("textbox")
  for (const text of ["Latest prompt", "第二条消息", "First prompt", "First prompt"]) {
    arrow("ArrowUp")
    expect(input).toHaveValue(text)
  }
  for (const text of ["第二条消息", "Latest prompt", ""]) {
    arrow("ArrowDown")
    expect(input).toHaveValue(text)
  }
  arrow("ArrowDown")
  expect(input).toHaveValue("")
  expect(submit).not.toHaveBeenCalled()
})

test("does not overwrite drafts, edited recalls, selections, modified keys or IME candidates", () => {
  render(<Composer session={session()} />)
  const input = screen.getByRole<HTMLTextAreaElement>("textbox")
  for (const extra of [
    { shiftKey: true },
    { ctrlKey: true },
    { altKey: true },
    { metaKey: true },
    { isComposing: true },
    { keyCode: 229 }
  ]) {
    arrow("ArrowUp", extra)
    expect(input).toHaveValue("")
  }
  fireEvent.change(input, { target: { value: "Unsent draft" } })
  input.setSelectionRange(0, 0)
  arrow("ArrowUp")
  expect(input).toHaveValue("Unsent draft")
  fireEvent.change(input, { target: { value: "" } })
  arrow("ArrowUp")
  input.setSelectionRange(0, 6)
  arrow("ArrowUp")
  expect(input).toHaveValue("Latest prompt")
  fireEvent.change(input, { target: { value: "Edited recall" } })
  arrow("ArrowDown")
  expect(input).toHaveValue("Edited recall")
  fireEvent.change(input, { target: { value: "" } })
  fireEvent.compositionStart(input)
  arrow("ArrowUp")
  expect(input).toHaveValue("")
})

test("multiline recall keeps cursor navigation, and histories belong to their session", () => {
  const view = render(<Composer key="first" session={session("first", ["Older", "Line one\nLine two"])} />)
  const input = screen.getByRole<HTMLTextAreaElement>("textbox")
  arrow("ArrowUp")
  expect(input).toHaveValue("Line one\nLine two")
  expect(arrow("ArrowUp")).toBe(true)
  input.setSelectionRange(0, 0)
  arrow("ArrowUp")
  expect(input).toHaveValue("Older")
  view.rerender(<Composer key="second" session={session("second", ["Other session"])} />)
  arrow("ArrowUp")
  expect(screen.getByRole("textbox")).toHaveValue("Other session")
})

test("slash completion keeps priority over prompt history", () => {
  const current = session()
  current.commands = [{ type: "command", name: "help", description: "Help" }]
  render(<Composer session={current} />)
  const input = screen.getByRole("textbox")
  fireEvent.change(input, { target: { value: "/" } })
  fireEvent.input(input)
  fireEvent.keyUp(input, { key: "/" })
  arrow("ArrowUp")
  expect(input).toHaveValue("/")
})
