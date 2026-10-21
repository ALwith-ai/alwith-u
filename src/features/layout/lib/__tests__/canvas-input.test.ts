import type { UseEmblaCarouselType } from "embla-carousel-react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import type { TrackpadGesture } from "@/bindings"

import { attachCanvasInput } from "../canvas-input"

type Api = NonNullable<UseEmblaCarouselType[1]>
let frames: Map<number, FrameRequestCallback>
let frameId: number
let now: number
const disposals: Array<() => void> = []

beforeEach(() => {
  frames = new Map()
  frameId = 0
  now = 1000
  vi.spyOn(performance, "now").mockImplementation(() => now)
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback)
    return frameId
  })
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id))
})
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose()
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
function flush(): void {
  const callbacks = [...frames.values()]
  frames.clear()
  callbacks.forEach((callback) => callback(now))
}
function pointer(target: EventTarget, type: string, button: number, clientX = 0): void {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button, clientX }))
}
function gesture(phase: TrackpadGesture["phase"], dx = 0, fingers = 3): TrackpadGesture {
  return {
    phase,
    dx,
    dy: 0,
    fingers,
    totalDx: dx,
    totalDy: 0,
    dSpread: 0,
    totalDSpread: 0,
    ts: now,
    deviceW: null,
    deviceH: null
  }
}

/** Controlled carousel boundary: synthetic DOM mouse events move its physical location.
 * Release deliberately chooses an inertia destination so input must override that decision.
 */
function harness() {
  const root = document.createElement("div")
  document.body.append(root)
  let viewport = 1000
  Object.defineProperty(root, "clientWidth", { get: () => viewport })
  const snaps = [0, -1000, -2000]
  let selected = 1
  let location = snaps[selected]
  let dragging = false
  let previousX = 0
  let blocked = false
  const synthetic: string[] = []
  root.addEventListener("mousedown", (event) => {
    dragging = true
    previousX = event.clientX
    synthetic.push(event.type)
  })
  root.addEventListener("mousemove", (event) => {
    if (!dragging) return
    location += event.clientX - previousX
    previousX = event.clientX
    synthetic.push(event.type)
  })
  root.addEventListener("mouseup", () => {
    dragging = false
    selected = 2
    synthetic.push("mouseup")
  })
  const listeners = new Map<string, () => void>()
  const api = {
    rootNode: () => root,
    selectedScrollSnap: () => selected,
    scrollSnapList: () => snaps,
    internalEngine: () => ({ location: { get: () => location }, scrollSnaps: snaps }),
    scrollTo: (index: number) => {
      selected = index
      location = snaps[index]
    },
    on: (name: string, callback: () => void) => {
      listeners.set(name, callback)
    },
    off: (name: string) => {
      listeners.delete(name)
    }
  } as unknown as Api
  const input = attachCanvasInput(api, () => blocked)
  disposals.push(input.dispose)
  return {
    root,
    input,
    synthetic,
    location: () => location,
    selected: () => selected,
    dragging: () => dragging,
    resize: (width: number) => {
      viewport = width
    },
    block: () => {
      blocked = true
    },
    reinit: () => listeners.get("reInit")?.()
  }
}

test("only three fingers drive continuous movement using the start width", () => {
  const h = harness()
  h.input.gesture(gesture("began", 0, 4))
  h.input.gesture(gesture("changed", -0.1, 4))
  expect(h.dragging()).toBe(false)
  expect(h.location()).toBe(-1000)
  h.input.gesture(gesture("began"))
  h.input.gesture(gesture("changed", -0.05))
  expect(h.location()).toBe(-1050)
  h.resize(2000)
  h.input.gesture(gesture("changed", -0.05))
  expect(h.location()).toBe(-1100)
  expect(h.synthetic).toEqual(["mousedown", "mousemove", "mousemove"])
})

test.each([
  [0.149, 1],
  [0.15, 0],
  [-0.15, 2]
])("release at %s resolves snap %s", (dx, expected) => {
  const h = harness()
  h.input.gesture(gesture("began"))
  h.input.gesture(gesture("changed", dx))
  h.input.gesture(gesture("ended"))
  expect(h.dragging()).toBe(false)
  flush()
  expect(h.selected()).toBe(expected)
})

test("native cancellation settles normally but active cancellation restores the initial snap", () => {
  const h = harness()
  h.input.gesture(gesture("began"))
  h.input.gesture(gesture("changed", -0.2))
  h.input.gesture(gesture("cancelled"))
  flush()
  expect(h.selected()).toBe(2)
  h.input.gesture(gesture("began"))
  h.input.gesture(gesture("changed", 0.6))
  h.input.cancel()
  flush()
  expect(h.selected()).toBe(2)
  expect(h.location()).toBe(-2000)
})

test("cancel restores the starting snap even when mouseup changes carousel selection", () => {
  const h = harness()
  h.input.gesture(gesture("began"))
  h.input.gesture(gesture("changed", -0.6))
  h.input.cancel()
  flush()
  expect(h.selected()).toBe(1)
  expect(h.location()).toBe(-1000)
  expect(h.dragging()).toBe(false)
})

test("right click within 300ms restores start and blocks immediate reentry", () => {
  const h = harness()
  h.input.gesture(gesture("began"))
  h.input.gesture(gesture("changed", -0.2))
  h.input.gesture(gesture("ended"))
  flush()
  now += 300
  pointer(h.root, "contextmenu", 2)
  expect(h.selected()).toBe(1)
  h.input.gesture(gesture("began"))
  expect(h.dragging()).toBe(false)
  now += 301
  h.input.gesture(gesture("began"))
  expect(h.dragging()).toBe(true)
})

test("right click after the guard interval does not rewind navigation", () => {
  const h = harness()
  h.input.gesture(gesture("began"))
  h.input.gesture(gesture("changed", -0.2))
  h.input.gesture(gesture("ended"))
  flush()
  now += 301
  pointer(h.root, "contextmenu", 2)
  expect(h.selected()).toBe(2)
})

test("middle mouse and trackpad never share a drag", () => {
  const h = harness()
  pointer(h.root, "pointerdown", 1, 200)
  h.input.gesture(gesture("began"))
  h.input.gesture(gesture("changed", -0.4))
  expect(h.location()).toBe(-1000)
  pointer(window, "pointermove", 1, 250)
  expect(h.location()).toBe(-950)
  pointer(window, "pointerup", 1, 250)
  flush()
  h.input.gesture(gesture("began"))
  pointer(h.root, "pointerdown", 1, 200)
  pointer(window, "pointermove", 1, 600)
  expect(h.location()).toBe(-1000)
  h.input.gesture(gesture("changed", -0.1))
  expect(h.location()).toBe(-1100)
})

test("dispose removes input listeners and stale release callbacks cannot navigate", () => {
  const h = harness()
  h.input.gesture(gesture("began"))
  h.input.gesture(gesture("changed", 0.2))
  h.input.gesture(gesture("ended"))
  const stale = [...frames.values()]
  h.input.dispose()
  stale.forEach((callback) => callback(now))
  h.input.gesture(gesture("began"))
  pointer(h.root, "pointerdown", 1)
  expect(h.dragging()).toBe(false)
  expect(h.selected()).toBe(1)
})

test("modal blocking and reinitialization abort active movement", () => {
  const h = harness()
  h.input.gesture(gesture("began"))
  h.input.gesture(gesture("changed", -0.2))
  h.reinit()
  expect(h.dragging()).toBe(false)
  expect(h.selected()).toBe(1)
  h.input.gesture(gesture("began"))
  h.block()
  h.input.gesture(gesture("changed", -0.2))
  expect(h.dragging()).toBe(false)
  expect(h.selected()).toBe(1)
})

test("cancelling before release animation restores start and invalidates the queued destination", () => {
  const h = harness()
  h.input.gesture(gesture("began"))
  h.input.gesture(gesture("changed", -0.2))
  h.input.gesture(gesture("ended"))
  h.input.cancel()
  flush()
  expect(h.selected()).toBe(1)
})

test("a rejected middle drag during the secondary guard does not leave a grabbing cursor", () => {
  const h = harness()
  pointer(h.root, "contextmenu", 2)
  pointer(h.root, "pointerdown", 1)
  expect(h.dragging()).toBe(false)
  expect(h.root.style.cursor).toBe("")
})

test("a repeated native begin restores before establishing the new drag origin", () => {
  const h = harness()
  h.input.gesture(gesture("began"))
  h.input.gesture(gesture("changed", -0.2))
  h.input.gesture(gesture("began"))
  expect(h.location()).toBe(-1000)
  h.input.gesture(gesture("changed", -0.05))
  h.input.gesture(gesture("ended"))
  flush()
  expect(h.selected()).toBe(1)
})
