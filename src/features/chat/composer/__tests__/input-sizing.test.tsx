import { PromptInputProvider } from "@alwith/module-chat/composer-context"
import { PromptInputTextarea } from "@alwith/module-chat/composer-textarea"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

let frames: Map<number, FrameRequestCallback>
let notify: ResizeObserverCallback
function setup(native: boolean) {
  frames = new Map()
  let sequence = 0
  vi.stubGlobal("CSS", { supports: () => native })
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++sequence, callback)
    return sequence
  })
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id))
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        notify = callback
      }
      observe() {}
      disconnect() {}
    }
  )
}
function flush() {
  const pending = [...frames.values()]
  frames.clear()
  act(() => {
    for (const callback of pending) callback(0)
  })
}
function Input({ value = "" }: { value?: string }) {
  return (
    <PromptInputProvider value={value} onValueChange={() => {}}>
      <PromptInputTextarea />
    </PromptInputProvider>
  )
}
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test("native sizing never measures layout during typing or dictation", () => {
  setup(true)
  const view = render(<Input />)
  const input = screen.getByRole("textbox")
  const read = vi.fn(() => 80)
  Object.defineProperty(input, "scrollHeight", { get: read })
  fireEvent.change(input, { target: { value: "typing" } })
  view.rerender(<Input value="dictated text" />)
  expect(frames.size).toBe(0)
  expect(read).not.toHaveBeenCalled()
  expect(input).toHaveValue("dictated text")
})

test("fallback coalesces writes, ignores height notifications and resizes external drafts", () => {
  setup(false)
  const view = render(<Input />)
  const input = screen.getByRole("textbox") as HTMLTextAreaElement
  const read = vi.fn(() => 80)
  Object.defineProperty(input, "scrollHeight", { get: read })
  const resize = (width: number, height: number) =>
    act(() => notify([{ contentRect: { width, height } } as ResizeObserverEntry], {} as ResizeObserver))
  resize(300, 40)
  fireEvent.change(input, { target: { value: "a" } })
  fireEvent.change(input, { target: { value: "ab" } })
  expect(read).not.toHaveBeenCalled()
  expect(frames.size).toBe(1)
  flush()
  expect(read).toHaveBeenCalledTimes(1)
  resize(300, 80)
  expect(frames.size).toBe(0)
  view.rerender(<Input value="voice preview" />)
  flush()
  expect(read).toHaveBeenCalledTimes(2)
  resize(200, 80)
  expect(frames.size).toBe(1)
  view.unmount()
  expect(frames.size).toBe(0)
})

test("fallback leaves IME composition unmeasured until confirmation", () => {
  setup(false)
  render(<Input />)
  const input = screen.getByRole("textbox")
  const read = vi.fn(() => 80)
  Object.defineProperty(input, "scrollHeight", { get: read })
  fireEvent.compositionStart(input)
  fireEvent.change(input, { target: { value: "ni" } })
  flush()
  expect(read).not.toHaveBeenCalled()
  fireEvent.compositionEnd(input, { data: "你" })
  flush()
  expect(read).toHaveBeenCalledTimes(1)
})
