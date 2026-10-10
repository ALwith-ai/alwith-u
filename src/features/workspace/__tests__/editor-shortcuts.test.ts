import { afterEach, expect, test, vi } from "vitest"
import { routeFind, routeHistory, routeReplace } from "../editor-shortcuts"
afterEach(() => {
  document.body.innerHTML = ""
  vi.restoreAllMocks()
})
test("find routes to the focused workspace editor and preserves chat search elsewhere", () => {
  document.body.innerHTML =
    '<section class="alwith-editor"><div data-code-editor><textarea></textarea></div></section><input id="chat" />'
  const openChat = vi.fn(),
    action = vi.fn()
  window.addEventListener("workspace:editor-action", action)
  document.querySelector("textarea")?.focus()
  routeFind(openChat)
  expect(openChat).not.toHaveBeenCalled()
  expect(action.mock.calls[0][0].detail).toBe("find")
  document.querySelector<HTMLInputElement>("#chat")?.focus()
  routeFind(openChat)
  expect(openChat).toHaveBeenCalledOnce()
  routeReplace()
  expect(action).toHaveBeenCalledOnce()
  window.removeEventListener("workspace:editor-action", action)
})
test("native undo reaches Monaco and uses native editable history elsewhere", () => {
  document.body.innerHTML =
    '<section class="alwith-editor"><div data-code-editor><textarea></textarea></div></section><input id="chat" />'
  const exec = vi.fn()
  Object.defineProperty(document, "execCommand", { configurable: true, value: exec })
  const action = vi.fn()
  window.addEventListener("workspace:editor-action", action)
  document.querySelector("textarea")?.focus()
  routeHistory("undo")
  expect(action.mock.calls[0][0].detail).toBe("undo")
  expect(exec).not.toHaveBeenCalled()
  document.querySelector<HTMLInputElement>("#chat")?.focus()
  routeHistory("redo")
  expect(exec).toHaveBeenCalledWith("redo")
  window.removeEventListener("workspace:editor-action", action)
})
