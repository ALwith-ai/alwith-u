import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"

import { afterEach, expect, test, vi } from "vitest"

import { installNativeFileDropGuard } from "../native-file-drop"

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
  document.body.replaceChildren()
})

function drag(type: string, types: string[], x = 100, y = 150): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    dataTransfer: { value: { types } },
    clientX: { value: x },
    clientY: { value: y }
  })
  return event
}

function pageDropTarget() {
  const target = document.createElement("div")
  document.body.append(target)
  const handler = vi.fn()
  for (const name of ["dragenter", "dragover", "drop", "dragleave"]) target.addEventListener(name, handler)
  return { target, handler }
}

test("the unpatched CEF bridge forwards native positions while the app blocks duplicate DOM handling", () => {
  const source = readFileSync("node_modules/@nyssance/tauri-runtime-cef/rust/src/cef_impl/client/drag.rs", "utf8")
  const script = source.match(/const DRAG_DROP_INIT_SCRIPT: &str = r#"([\s\S]*?)"#;/)?.[1]
  if (!script) throw new Error("The installed CEF runtime has no drag bridge")
  expect(script).not.toContain("stopImmediatePropagation")
  const fetch = vi.fn(async (_url: string) => ({}))
  runInNewContext(script, {
    window: {
      location: window.location,
      devicePixelRatio: 2,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      addEventListener: (name: string, listener: EventListener, options: AddEventListenerOptions) => {
        window.addEventListener(name, listener, options)
        cleanups.push(() => window.removeEventListener(name, listener, options))
      }
    },
    fetch,
    URL
  })
  cleanups.push(installNativeFileDropGuard(window))
  const { target, handler } = pageDropTarget()
  for (const name of ["dragenter", "dragover", "drop"]) {
    const event = drag(name, ["Files"])
    target.dispatchEvent(event)
    expect(event.defaultPrevented, name).toBe(true)
  }
  expect(handler).not.toHaveBeenCalled()
  expect(fetch.mock.calls.map(([url]) => JSON.parse(new URL(url).searchParams.get("payload")!))).toEqual([
    { type: "enter", x: 200, y: 300 },
    { type: "over", x: 200, y: 300 },
    { type: "drop", x: 200, y: 300 }
  ])
})

test("text, link and element drags remain available after a file drop", () => {
  cleanups.push(installNativeFileDropGuard(window))
  const { target, handler } = pageDropTarget()
  target.dispatchEvent(drag("drop", ["Files"]))
  for (const types of [["text/plain"], ["text/uri-list"], []]) {
    for (const name of ["dragenter", "dragover", "drop", "dragleave"]) {
      const event = drag(name, types)
      target.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
    }
  }
  expect(handler).toHaveBeenCalledTimes(12)
})

test("file drags retain ownership across child boundaries and missing transfer types, then reset on exit", () => {
  cleanups.push(installNativeFileDropGuard(window))
  const { target, handler } = pageDropTarget()
  for (const [name, types, x] of [
    ["dragenter", ["Files"], 100],
    ["dragleave", [], 100],
    ["dragover", [], 100],
    ["dragleave", [], 0]
  ] as const) {
    const event = drag(name, [...types], x)
    target.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  }
  expect(handler).not.toHaveBeenCalled()
  const text = drag("dragenter", ["text/plain"])
  target.dispatchEvent(text)
  expect(text.defaultPrevented).toBe(false)
  expect(handler).toHaveBeenCalledOnce()
})

test("disposing the guard restores DOM file handling", () => {
  const dispose = installNativeFileDropGuard(window)
  dispose()
  const { target, handler } = pageDropTarget()
  const event = drag("drop", ["Files"])
  target.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(false)
  expect(handler).toHaveBeenCalledOnce()
})
