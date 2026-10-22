import { afterEach, expect, test } from "vitest"

import { preventVibemonImageDragging } from "../image-drag"

let stop: (() => void) | undefined
afterEach(() => {
  stop?.()
  document.body.replaceChildren()
})

test("images added after pet startup cannot start a browser drag while pointer gestures remain available", () => {
  stop = preventVibemonImageDragging()
  const image = document.createElement("img")
  document.body.append(image)
  const drag = new Event("dragstart", { bubbles: true, cancelable: true })
  image.dispatchEvent(drag)
  expect(drag.defaultPrevented).toBe(true)
  const pointer = new Event("pointerdown", { bubbles: true, cancelable: true })
  image.dispatchEvent(pointer)
  expect(pointer.defaultPrevented).toBe(false)
})

test("the image guard leaves other drags alone and releases its document listener", () => {
  stop = preventVibemonImageDragging()
  const link = document.createElement("a")
  document.body.append(link)
  expect(link.dispatchEvent(new Event("dragstart", { bubbles: true, cancelable: true }))).toBe(true)
  stop()
  const image = document.createElement("img")
  document.body.append(image)
  expect(image.dispatchEvent(new Event("dragstart", { bubbles: true, cancelable: true }))).toBe(true)
})
