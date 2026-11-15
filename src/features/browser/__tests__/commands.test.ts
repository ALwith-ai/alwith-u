import { expect, test } from "vitest"

import { isPaneCommand, keyCommand } from "../commands"

const key = (code: string, extra: Partial<Parameters<typeof keyCommand>[0]> = {}) =>
  keyCommand({ code, metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, ...extra })

test("browser chords map to commands and editing chords stay with the page", () => {
  expect(key("KeyL")).toBe("focus-address")
  expect(key("KeyR")).toBe("reload")
  expect(key("KeyR", { shiftKey: true })).toBe("hard-reload")
  expect(key("KeyT", { shiftKey: true })).toBe("reopen-tab")
  expect(key("Digit9")).toBe("tab-last")
  expect(key("BracketRight", { shiftKey: true })).toBe("next-tab")
  expect(key("KeyF")).toBe("find")
  expect(key("KeyG", { shiftKey: true })).toBe("find-previous")
  expect(key("KeyD")).toBe("bookmark")
  expect(key("KeyP")).toBe("print")
  expect(key("KeyU", { altKey: true })).toBe("view-source")
  expect(key("KeyU")).toBeUndefined()
  for (const code of ["KeyA", "KeyC", "KeyV", "KeyX", "KeyZ"]) expect(key(code)).toBeUndefined()
  expect(key("KeyZ", { shiftKey: true })).toBeUndefined()
})

test("a chord needs exactly the command modifier and never fires during composition", () => {
  expect(key("KeyL", { metaKey: false })).toBeUndefined()
  expect(key("KeyL", { metaKey: false, ctrlKey: true })).toBeUndefined()
  expect(key("KeyL", { altKey: true })).toBeUndefined()
  expect(key("KeyL", { ctrlKey: true })).toBeUndefined()
  expect(key("KeyL", { isComposing: true })).toBeUndefined()
})

test("pane commands are the ones a single tab handles", () => {
  expect(isPaneCommand("stop")).toBe(true)
  expect(isPaneCommand("new-tab")).toBe(false)
})
