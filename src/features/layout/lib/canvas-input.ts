import type { UseEmblaCarouselType } from "embla-carousel-react"

import type { TrackpadGesture } from "@/bindings"

import { resolveReleaseSnap } from "./canvas-geometry"

type CanvasApi = NonNullable<UseEmblaCarouselType[1]>

/** A single owner for synthetic dragging. Native and middle-button input never overlap. */
export function attachCanvasInput(
  api: CanvasApi,
  blocked: () => boolean
): {
  gesture: (event: TrackpadGesture) => void
  cancel: () => void
  dispose: () => void
} {
  const root = api.rootNode()
  let owner: "trackpad" | "mouse" | null = null
  let x = 0
  let startIndex = 0
  let startLocation = 0
  let width = 0
  let releaseFrame = 0
  let secondaryUntil = -Infinity
  let lastEnd = -Infinity
  let disposed = false
  const forward = (type: string): void => {
    root.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 0, button: 0 }))
  }
  const clearRelease = (): void => {
    cancelAnimationFrame(releaseFrame)
    releaseFrame = 0
  }
  const restore = (): void => {
    clearRelease()
    api.scrollTo(Math.min(startIndex, api.scrollSnapList().length - 1))
  }
  const end = (cancelled: boolean): void => {
    if (!owner) return
    owner = null
    root.style.cursor = ""
    const location = api.internalEngine().location.get()
    const target = cancelled
      ? startIndex
      : resolveReleaseSnap({
          startIndex,
          location,
          displacement: location - startLocation,
          snapPoints: api.internalEngine().scrollSnaps,
          viewportWidth: width
        })
    forward("mouseup")
    lastEnd = performance.now()
    clearRelease()
    releaseFrame = requestAnimationFrame(() => {
      releaseFrame = 0
      if (!disposed) api.scrollTo(Math.min(target, api.scrollSnapList().length - 1))
    })
  }
  const cancel = (): void => {
    const interrupted = owner !== null || releaseFrame !== 0
    if (owner) end(true)
    clearRelease()
    if (!disposed)
      api.scrollTo(interrupted ? Math.min(startIndex, api.scrollSnapList().length - 1) : api.selectedScrollSnap(), true)
  }
  const begin = (kind: "trackpad" | "mouse", initialX: number): void => {
    if (owner || blocked() || performance.now() <= secondaryUntil) return
    clearRelease()
    width = root.clientWidth
    if (width <= 0) return
    startIndex = api.selectedScrollSnap()
    startLocation = api.internalEngine().location.get()
    x = initialX
    owner = kind
    forward("mousedown")
  }
  const secondary = (): void => {
    secondaryUntil = performance.now() + 300
    const shouldRestore = owner !== null || performance.now() - lastEnd <= 300
    end(true)
    if (shouldRestore) restore()
  }
  const down = (event: PointerEvent): void => {
    if (!(event.target instanceof Node) || !root.contains(event.target)) return
    if (event.button === 2) secondary()
    if (
      event.button !== 1 ||
      (event.target instanceof Element && event.target.closest("[data-no-drag], [role=separator]"))
    )
      return
    if (blocked() || owner) return
    event.preventDefault()
    begin("mouse", event.clientX)
    if (owner === "mouse") root.style.cursor = "grabbing"
  }
  const move = (event: PointerEvent): void => {
    if (owner !== "mouse") return
    if (blocked()) {
      cancel()
      return
    }
    x = event.clientX
    forward("mousemove")
  }
  const up = (event: PointerEvent): void => {
    if (owner === "mouse" && event.button === 1) end(false)
  }
  const menu = (event: MouseEvent): void => {
    if (event.target instanceof Node && root.contains(event.target)) secondary()
  }
  const scroll = (): void => {
    root.scrollLeft = 0
  }
  const reinit = (): void => cancel()
  window.addEventListener("pointerdown", down, true)
  window.addEventListener("contextmenu", menu, true)
  window.addEventListener("pointermove", move)
  window.addEventListener("pointerup", up)
  window.addEventListener("pointercancel", cancel)
  window.addEventListener("blur", cancel)
  root.addEventListener("scroll", scroll)
  api.on("reInit", reinit)
  return {
    gesture(event): void {
      if (disposed || event.fingers !== 3) return
      if (!Number.isFinite(event.dx) || !Number.isFinite(event.dy)) throw new Error("Invalid trackpad delta")
      if (blocked()) {
        cancel()
        return
      }
      if (event.phase === "began") {
        if (owner === "trackpad") cancel()
        begin("trackpad", 0)
      } else if (owner === "trackpad") {
        if (event.phase === "changed") {
          x += event.dx * width
          forward("mousemove")
        } else if (event.phase === "ended" || event.phase === "cancelled") end(false)
        else throw new Error("Invalid trackpad phase")
      }
    },
    cancel,
    dispose(): void {
      if (disposed) return
      cancel()
      disposed = true
      window.removeEventListener("pointerdown", down, true)
      window.removeEventListener("contextmenu", menu, true)
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", cancel)
      window.removeEventListener("blur", cancel)
      root.removeEventListener("scroll", scroll)
      api.off("reInit", reinit)
    }
  }
}
