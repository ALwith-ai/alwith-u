import { describe, expect, it, vi } from "vitest"

import script from "../../../src-tauri/patches/tauri/src/window/scripts/drag.js?raw"

const startDragging = "plugin:window|start_dragging"
const toggleMaximize = "plugin:window|internal_toggle_maximize"

function setup(platform: "macos" | "windows") {
  const page = document.implementation.createHTMLDocument()
  const invoke = vi.fn()
  const host = { __TAURI_INTERNALS__: { invoke } }
  const titlebar = page.createElement("header")
  titlebar.setAttribute("data-tauri-drag-region", "")
  page.body.append(titlebar)
  const load = new Function("window", "document", script.replace("__TEMPLATE_os_name__", JSON.stringify(platform)))
  load(host, page)

  function mouse(target: EventTarget, type: string, options: MouseEventInit) {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 20, ...options }))
  }

  return {
    invoke,
    down: (detail = 1) => mouse(titlebar, "mousedown", { detail, buttons: 1 }),
    move: () => mouse(titlebar, "mousemove", { buttons: 1, clientX: 21 }),
    up: (detail = 1) => mouse(titlebar, "mouseup", { detail })
  }
}

describe("Tauri title-bar drag handoff", () => {
  it("hands mouse-down to macOS once and leaves movement detection to AppKit", () => {
    const gesture = setup("macos")
    gesture.down()
    expect(gesture.invoke).toHaveBeenCalledExactlyOnceWith(startDragging)
    gesture.move()
    gesture.up()
    expect(gesture.invoke).toHaveBeenCalledTimes(1)
  })

  it("preserves the native double-click and Windows mouse-down handoffs", () => {
    const mac = setup("macos")
    mac.down(2)
    mac.up(2)
    expect(mac.invoke).toHaveBeenCalledExactlyOnceWith(toggleMaximize)

    const windows = setup("windows")
    windows.down()
    expect(windows.invoke).toHaveBeenCalledExactlyOnceWith(startDragging)
  })
})
