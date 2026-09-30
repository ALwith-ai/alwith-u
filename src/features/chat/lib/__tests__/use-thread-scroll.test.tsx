import { afterEach, beforeEach, expect, spyOn, test } from "bun:test"
import { act, cleanup, renderHook } from "@testing-library/react"
import { installDom } from "../../codex/__tests__/dom-environment"
import { useThreadScroll } from "../use-thread-scroll"

installDom()
const originalRequest = globalThis.requestAnimationFrame
const originalCancel = globalThis.cancelAnimationFrame
const frames = new Map<number, FrameRequestCallback>()
let nextFrame = 0
let time = 0
beforeEach(() => {
  time = performance.now()
  globalThis.requestAnimationFrame = callback => {
    frames.set(++nextFrame, callback)
    return nextFrame
  }
  globalThis.cancelAnimationFrame = id => {
    frames.delete(id)
  }
})
afterEach(() => {
  cleanup()
  document.body.replaceChildren()
  frames.clear()
  globalThis.requestAnimationFrame = originalRequest
  globalThis.cancelAnimationFrame = originalCancel
})

function tick(milliseconds = 16) {
  time += milliseconds
  act(() => {
    const pending = [...frames.values()]
    frames.clear()
    for (const callback of pending) callback(time)
  })
}
function settle() {
  for (let i = 0; i < 60 && frames.size > 0; i++) tick()
  expect(frames.size).toBe(0)
}
function setup(top = 800, running = true, roundPixels = false) {
  const scrollArea = document.createElement("div")
  scrollArea.setAttribute("data-slot", "scroll-area")
  const root = document.createElement("div")
  scrollArea.append(root)
  document.body.append(scrollArea)
  let height = 1400
  let position = top
  Object.defineProperties(root, {
    clientHeight: { value: 600 },
    scrollHeight: { get: () => height },
    scrollTop: {
      get: () => position,
      set: (value: number) => {
        position = Math.max(0, Math.min(roundPixels ? Math.round(value) : value, height - 600))
      }
    },
    scrollTo: {
      value: ({ top }: ScrollToOptions) => {
        if (top === undefined) throw new Error("Test scroll target is missing")
        root.scrollTop = top
      }
    }
  })
  const releaseTurnAnchor = () => {}
  const hook = renderHook(() => useThreadScroll(root, running, releaseTurnAnchor))
  return {
    root,
    scrollArea,
    result: hook.result,
    unmount: hook.unmount,
    resize(value: number) {
      height = value
      position = Math.max(0, Math.min(position, height - 600))
    },
    scroll(value: number) {
      act(() => {
        root.scrollTop = value
        root.dispatchEvent(new Event("scroll"))
      })
    },
    wheel(deltaY: number) {
      act(() => {
        root.dispatchEvent(new WheelEvent("wheel", { deltaY }))
      })
    },
    disclosure() {
      const button = document.createElement("button")
      button.setAttribute("data-codex-disclosure", "")
      root.append(button)
      act(() => button.click())
    }
  }
}

test("restored history and layout corrections do not enable following", () => {
  const view = setup(400)
  view.scroll(780)
  act(() => view.result.current.contentResized())
  settle()
  expect(view.root.scrollTop).toBe(780)
  expect(view.result.current.isFollowing).toBe(false)
})

test("wheel up cancels the queued pin before its delayed scroll event", () => {
  const view = setup()
  view.resize(1600)
  act(() => view.result.current.schedulePin())
  view.wheel(-80)
  view.scroll(720)
  settle()
  expect(view.root.scrollTop).toBe(720)
  view.scroll(950)
  expect(view.result.current.isFollowing).toBe(false)
})

test("layout correction while following does not release the viewport", () => {
  const view = setup()
  view.resize(1600)
  view.scroll(760)
  expect(view.result.current.isFollowing).toBe(true)
  act(() => view.result.current.contentResized())
  settle()
  expect(view.root.scrollTop).toBe(1000)
})

test("downward input near a streaming answer resumes smoothly and tracks growth", () => {
  const view = setup(400)
  view.wheel(300)
  view.scroll(700)
  expect(view.root.scrollTop).toBe(700)
  expect(view.result.current.isFollowing).toBe(true)
  tick(40)
  expect(view.root.scrollTop).toBeGreaterThan(700)
  expect(view.root.scrollTop).toBeLessThan(800)
  view.resize(1500)
  act(() => view.result.current.contentResized())
  settle()
  expect(view.root.scrollTop).toBe(900)
})

test("return animation starts each frame from the actual position, including further wheel movement", () => {
  const view = setup(200)
  act(() => view.result.current.scrollToBottom())
  tick(30)
  view.wheel(500)
  view.scroll(780)
  tick()
  expect(view.root.scrollTop).toBeGreaterThanOrEqual(780)
  view.wheel(-100)
  view.scroll(680)
  view.resize(1800)
  act(() => view.result.current.contentResized())
  settle()
  expect(view.root.scrollTop).toBe(680)
})

test("new-turn positioning suspends pins and user input invalidates its completion", () => {
  const view = setup()
  let location!: ReturnType<typeof view.result.current.beginLocate>
  act(() => {
    location = view.result.current.beginLocate(true)
    view.result.current.contentResized()
  })
  expect(frames.size).toBe(0)
  view.wheel(-80)
  view.scroll(720)
  act(() => location.finish(800))
  expect(location.isCurrent()).toBe(false)
  expect(view.root.scrollTop).toBe(720)
})

test("a completed new-turn location resumes follow; a history location remains released", () => {
  const view = setup(200)
  act(() => view.result.current.beginLocate(true).finish(750))
  view.resize(1600)
  act(() => view.result.current.contentResized())
  settle()
  expect(view.root.scrollTop).toBe(1000)
  act(() => view.result.current.beginLocate(false).finish(400))
  act(() => view.result.current.contentResized())
  settle()
  expect(view.root.scrollTop).toBe(400)
  expect(view.result.current.isFollowing).toBe(false)
})

test("downward user input also cancels an unfinished new-turn location", () => {
  const view = setup(200)
  let location!: ReturnType<typeof view.result.current.beginLocate>
  act(() => {
    location = view.result.current.beginLocate(true)
  })
  view.wheel(100)
  view.scroll(300)
  act(() => location.finish(800))
  expect(location.isCurrent()).toBe(false)
  expect(view.root.scrollTop).toBe(300)
})

test("completion cancels an unfinished new-turn location without losing follow intent", () => {
  const view = setup()
  let location!: ReturnType<typeof view.result.current.beginLocate>
  act(() => {
    location = view.result.current.beginLocate(true)
    view.result.current.cancelLocation()
  })
  act(() => location.finish(200))
  expect(view.root.scrollTop).toBe(800)
  view.resize(1600)
  act(() => view.result.current.contentResized())
  settle()
  expect(view.root.scrollTop).toBe(1000)
})

test("collapsing content naturally to the bottom restores following", () => {
  const view = setup(400)
  view.disclosure()
  view.resize(900)
  act(() => view.result.current.contentResized())
  settle()
  expect(view.result.current.isFollowing).toBe(true)
  expect(view.root.scrollTop).toBe(300)
})

test("expansion and a later unrelated shrink do not resume following", () => {
  const view = setup()
  view.disclosure()
  view.resize(1800)
  act(() => view.result.current.contentResized())
  expect(view.result.current.isFollowing).toBe(false)
  view.resize(1400)
  act(() => view.result.current.contentResized())
  expect(view.result.current.isFollowing).toBe(false)
})

test("idle history uses the narrow bottom band", () => {
  const view = setup(400, false)
  view.wheel(300)
  view.scroll(700)
  expect(view.result.current.isFollowing).toBe(false)
  view.wheel(90)
  view.scroll(790)
  settle()
  expect(view.root.scrollTop).toBe(800)
})

test("reduced motion completes on one frame", () => {
  const media = spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList)
  try {
    const view = setup(400)
    act(() => view.result.current.scrollToBottom())
    tick()
    expect(view.root.scrollTop).toBe(800)
    expect(frames.size).toBe(0)
  } finally {
    media.mockRestore()
  }
})

test("120Hz following reaches the bottom when the webview rounds scroll positions", () => {
  const view = setup(750, true, true)
  act(() => view.result.current.scrollToBottom())
  for (let i = 0; i < 120 && frames.size > 0; i++) tick(8)
  expect(view.root.scrollTop).toBe(800)
  expect(frames.size).toBe(0)
})

test("scrollbar dragging owns the viewport until pointer release", () => {
  const view = setup()
  act(() => view.root.dispatchEvent(new PointerEvent("pointerdown", { button: 0 })))
  view.scroll(400)
  view.scroll(750)
  act(() => view.result.current.contentResized())
  settle()
  expect(view.root.scrollTop).toBe(750)
  act(() => window.dispatchEvent(new PointerEvent("pointerup")))
  settle()
  expect(view.root.scrollTop).toBe(800)
})

test("overlay scrollbar dragging pauses following until a downward release near the bottom", () => {
  const view = setup()
  const scrollbar = document.createElement("div")
  scrollbar.setAttribute("data-slot", "scroll-area-scrollbar")
  scrollbar.setAttribute("data-orientation", "vertical")
  const thumb = document.createElement("div")
  scrollbar.append(thumb)
  view.scrollArea.append(scrollbar)
  act(() => thumb.dispatchEvent(new PointerEvent("pointerdown", { button: 0, bubbles: true })))
  expect(view.result.current.isFollowing).toBe(false)
  view.scroll(400)
  view.scroll(750)
  act(() => view.result.current.contentResized())
  settle()
  expect(view.root.scrollTop).toBe(750)
  act(() => window.dispatchEvent(new PointerEvent("pointerup")))
  settle()
  expect(view.root.scrollTop).toBe(800)
  expect(view.result.current.isFollowing).toBe(true)
})

test("wheel scrolling inside an output block does not release viewport following", () => {
  const view = setup()
  const output = document.createElement("div")
  output.style.overflowY = "auto"
  Object.defineProperties(output, { clientHeight: { value: 100 }, scrollHeight: { value: 300 } })
  output.scrollTop = 100
  view.root.append(output)
  act(() => output.dispatchEvent(new WheelEvent("wheel", { deltaY: -20, bubbles: true })))
  expect(view.result.current.isFollowing).toBe(true)
})

test("keyboard scrolling releases follow and unmount cancels every pending write", () => {
  const view = setup()
  act(() => view.root.dispatchEvent(new KeyboardEvent("keydown", { key: "PageUp" })))
  expect(view.result.current.isFollowing).toBe(false)
  act(() => view.result.current.scrollToBottom())
  view.unmount()
  expect(frames.size).toBe(0)
})
