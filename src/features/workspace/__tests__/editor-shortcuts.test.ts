import { afterEach, expect, test, vi } from "vitest"

import { listenForEditHistory, routeFind, routeHistory, routeReplace } from "../editor-shortcuts"

const { listen } = vi.hoisted(() => ({ listen: vi.fn<(event: string, handle: () => void) => Promise<() => void>>() }))
vi.mock("@tauri-apps/api/webviewWindow", () => ({ getCurrentWebviewWindow: () => ({ listen }) }))

afterEach(() => {
  document.body.innerHTML = ""
  vi.restoreAllMocks()
  listen.mockReset()
})
test("find routes to the focused workspace editor and preserves chat search elsewhere", () => {
  document.body.innerHTML =
    '<section class="alwith-editor"><div data-code-editor><textarea></textarea></div></section><input id="chat" />'
  const openChat = vi.fn(),
    action = vi.fn<(event: Event) => void>()
  window.addEventListener("workspace:editor-action", action)
  document.querySelector("textarea")?.focus()
  routeFind(openChat)
  expect(openChat).not.toHaveBeenCalled()
  expect((action.mock.calls[0][0] as CustomEvent<string>).detail).toBe("find")
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
  const action = vi.fn<(event: Event) => void>()
  window.addEventListener("workspace:editor-action", action)
  document.querySelector("textarea")?.focus()
  routeHistory("undo")
  expect((action.mock.calls[0][0] as CustomEvent<string>).detail).toBe("undo")
  expect(exec).not.toHaveBeenCalled()
  document.querySelector<HTMLInputElement>("#chat")?.focus()
  routeHistory("redo")
  expect(exec).toHaveBeenCalledWith("redo")
  window.removeEventListener("workspace:editor-action", action)
})

test("native menu actions use the focused inline composer's own history", async () => {
  document.body.innerHTML = '<div contenteditable="true" tabindex="0" data-inline-input></div>'
  const inline = document.querySelector<HTMLElement>("[data-inline-input]")!
  const history: string[] = []
  inline.addEventListener("beforeinput", (event) => {
    event.preventDefault()
    history.push(event.inputType)
  })
  listen.mockResolvedValue(() => {})
  await listenForEditHistory()
  expect(listen.mock.calls.map(([event]) => event)).toEqual(["menu:edit-undo", "menu:edit-redo"])
  inline.focus()
  for (const [, handle] of listen.mock.calls) handle()
  expect(history).toEqual(["historyUndo", "historyRedo"])
})
