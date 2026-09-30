import { useCallback, useEffect, useRef, useState } from "react"

const BOTTOM_DISTANCE_PX = 24
const STREAMING_ENGAGE_DISTANCE_PX = 160
// Exponential following keeps its velocity when chunks arrive; it does not restart
// an animation from an obsolete scroll position for every update.
const FOLLOW_RESPONSE_MS = 45
type ScrollMode = "following" | "reading" | "locating"

export function useThreadScroll(root: HTMLElement | null, running: boolean, releaseTurnAnchor: () => void) {
  const mode = useRef<ScrollMode>("following")
  const [isFollowing, setIsFollowing] = useState(true)
  const streaming = useRef(running)
  streaming.current = running
  const frame = useRef<number | null>(null)
  const previousFrameTime = useRef(0)
  const lastWrittenTop = useRef(0)
  const fractionalOffset = useRef(0)
  const previousTop = useRef(0)
  const inputDirection = useRef(0)
  const locationId = useRef(0)
  const followAfterLocation = useRef(false)
  const disclosureHeight = useRef<number | null>(null)

  const cancelFrame = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
  }, [])

  const stopFollowing = useCallback(() => {
    releaseTurnAnchor()
    cancelFrame()
    locationId.current++
    disclosureHeight.current = null
    inputDirection.current = 0
    mode.current = "reading"
    setIsFollowing(false)
  }, [cancelFrame, releaseTurnAnchor])

  const schedulePin = useCallback(() => {
    if (root === null || mode.current !== "following" || frame.current !== null) return
    previousFrameTime.current = performance.now()
    lastWrittenTop.current = root.scrollTop
    fractionalOffset.current = 0
    const tick = (time: number) => {
      frame.current = null
      if (mode.current !== "following") return
      const target = Math.max(0, root.scrollHeight - root.clientHeight)
      const distance = target - root.scrollTop
      const immediate = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      if (immediate || Math.abs(distance) <= 1) {
        root.scrollTop = target
      } else {
        // A frame timestamp can precede the event that requested this frame.
        const elapsed = Math.max(0, time - previousFrameTime.current)
        // Webviews can round scrollTop to pixels. Carry subpixel progress so
        // 120Hz following cannot stall a few pixels short of the bottom.
        const offset = root.scrollTop === lastWrittenTop.current ? fractionalOffset.current : 0
        const next = root.scrollTop + offset + (distance - offset) * (1 - Math.exp(-elapsed / FOLLOW_RESPONSE_MS))
        root.scrollTop = next
        lastWrittenTop.current = root.scrollTop
        fractionalOffset.current = next - root.scrollTop
        frame.current = requestAnimationFrame(tick)
      }
      previousFrameTime.current = time
      previousTop.current = root.scrollTop
    }
    frame.current = requestAnimationFrame(tick)
  }, [root])

  const scrollToBottom = useCallback(() => {
    releaseTurnAnchor()
    locationId.current++
    disclosureHeight.current = null
    inputDirection.current = 0
    mode.current = "following"
    setIsFollowing(true)
    schedulePin()
  }, [releaseTurnAnchor, schedulePin])

  // Package navigation mounts the target first. Until U's precise positioning
  // finishes, content updates may measure the list but must not queue a second pin.
  const beginLocate = useCallback(
    (followAfter: boolean) => {
      releaseTurnAnchor()
      cancelFrame()
      const request = ++locationId.current
      mode.current = "locating"
      followAfterLocation.current = followAfter
      disclosureHeight.current = null
      inputDirection.current = 0
      setIsFollowing(followAfter)
      return {
        isCurrent: () => locationId.current === request,
        finish: (top: number) => {
          if (locationId.current !== request || root === null) return
          root.scrollTo({ top, behavior: "instant" })
          previousTop.current = root.scrollTop
          mode.current = followAfter ? "following" : "reading"
        }
      }
    },
    [cancelFrame, releaseTurnAnchor, root]
  )

  const cancelLocation = useCallback(() => {
    locationId.current++
    if (mode.current === "locating") mode.current = followAfterLocation.current ? "following" : "reading"
  }, [])

  const contentResized = useCallback(
    (anchorTop: number | null = null) => {
      if (root === null) return
      const heightBeforeDisclosure = disclosureHeight.current
      if (heightBeforeDisclosure !== null && root.scrollHeight !== heightBeforeDisclosure) {
        disclosureHeight.current = null
        // Preserve collapse-to-bottom reattachment, without allowing unrelated
        // virtual-list compensation to resume following while browsing history.
        if (
          root.scrollHeight < heightBeforeDisclosure &&
          root.scrollHeight - root.clientHeight - root.scrollTop <= BOTTOM_DISTANCE_PX
        ) {
          scrollToBottom()
        }
      }
      if (mode.current === "following" && anchorTop !== null) {
        cancelFrame()
        root.scrollTo({ top: anchorTop, behavior: "instant" })
        previousTop.current = root.scrollTop
      } else {
        schedulePin()
      }
    },
    [cancelFrame, root, schedulePin, scrollToBottom]
  )

  useEffect(() => {
    if (root === null) return
    // The package restores the history position in its preceding layout effect.
    previousTop.current = root.scrollTop
    mode.current =
      root.scrollHeight - root.clientHeight - root.scrollTop <= BOTTOM_DISTANCE_PX ? "following" : "reading"
    setIsFollowing(mode.current === "following")
    let draggingScrollbar = false
    let scrollbarMovedDown = false
    let touchY: number | null = null
    // Pane's overlay scrollbar is a sibling of the viewport, so its gestures do not bubble through root.
    const scrollArea = root.closest<HTMLElement>('[data-slot="scroll-area"]')
    const pointerRoot = scrollArea ?? root
    const input = (direction: number) => {
      disclosureHeight.current = null
      if ((direction < 0 || mode.current === "locating") && root.scrollHeight > root.clientHeight) stopFollowing()
      else releaseTurnAnchor()
      inputDirection.current = direction
      if (direction > 0 && root.scrollHeight - root.clientHeight - root.scrollTop <= 1) scrollToBottom()
    }
    const onScroll = () => {
      const movedDown = root.scrollTop > previousTop.current
      previousTop.current = root.scrollTop
      const userMovedDown = movedDown && inputDirection.current > 0
      inputDirection.current = 0
      if (draggingScrollbar) {
        scrollbarMovedDown = movedDown
        return
      }
      if (mode.current !== "reading" || !userMovedDown) return
      const engageDistance = streaming.current ? STREAMING_ENGAGE_DISTANCE_PX : BOTTOM_DISTANCE_PX
      if (root.scrollHeight - root.clientHeight - root.scrollTop <= engageDistance) scrollToBottom()
    }
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.deltaY === 0) return
      // Wheel input consumed by a code/output scroller is not a viewport gesture.
      let element = event.target instanceof Element ? event.target : null
      while (element !== null && element !== root) {
        if (element.scrollHeight > element.clientHeight && /auto|scroll/.test(getComputedStyle(element).overflowY)) {
          const canScroll =
            event.deltaY < 0 ? element.scrollTop > 0 : element.scrollTop + element.clientHeight < element.scrollHeight
          if (canScroll) return
        }
        element = element.parentElement
      }
      input(Math.sign(event.deltaY))
    }
    const onTouchStart = (event: TouchEvent) => {
      touchY = event.touches[0].clientY
    }
    const onTouchMove = (event: TouchEvent) => {
      const nextY = event.touches[0].clientY
      if (touchY !== null && nextY !== touchY) input(Math.sign(touchY - nextY))
      touchY = nextY
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !(event.target instanceof Element)) return
      if (event.target.closest("input, textarea, select, button, a, [contenteditable='true']")) return
      if (["ArrowUp", "PageUp", "Home"].includes(event.key) || (event.key === " " && event.shiftKey)) input(-1)
      else if (["ArrowDown", "PageDown", "End", " "].includes(event.key)) input(1)
    }
    const onPointerDown = (event: PointerEvent) => {
      const scrollbar =
        event.target instanceof Element
          ? event.target.closest('[data-slot="scroll-area-scrollbar"][data-orientation="vertical"]')
          : null
      const ownsScrollbar = scrollbar !== null && scrollbar.closest('[data-slot="scroll-area"]') === scrollArea
      draggingScrollbar =
        (event.target === root || ownsScrollbar) && event.button === 0 && root.scrollHeight > root.clientHeight
      scrollbarMovedDown = false
      if (draggingScrollbar) stopFollowing()
    }
    const onPointerUp = () => {
      const engageDistance = streaming.current ? STREAMING_ENGAGE_DISTANCE_PX : BOTTOM_DISTANCE_PX
      if (
        draggingScrollbar &&
        scrollbarMovedDown &&
        root.scrollHeight - root.clientHeight - root.scrollTop <= engageDistance
      )
        scrollToBottom()
      draggingScrollbar = false
    }
    const onPointerCancel = () => {
      draggingScrollbar = false
    }
    const onDisclosure = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || event.target.closest("[data-codex-disclosure]") === null) return
      stopFollowing()
      disclosureHeight.current = root.scrollHeight
    }
    root.addEventListener("scroll", onScroll, { passive: true })
    root.addEventListener("wheel", onWheel, { passive: true })
    root.addEventListener("touchstart", onTouchStart, { passive: true })
    root.addEventListener("touchmove", onTouchMove, { passive: true })
    root.addEventListener("keydown", onKeyDown)
    pointerRoot.addEventListener("pointerdown", onPointerDown, { capture: true })
    window.addEventListener("pointerup", onPointerUp)
    window.addEventListener("pointercancel", onPointerCancel)
    root.addEventListener("click", onDisclosure, { capture: true })
    return () => {
      cancelFrame()
      cancelLocation()
      root.removeEventListener("scroll", onScroll)
      root.removeEventListener("wheel", onWheel)
      root.removeEventListener("touchstart", onTouchStart)
      root.removeEventListener("touchmove", onTouchMove)
      root.removeEventListener("keydown", onKeyDown)
      pointerRoot.removeEventListener("pointerdown", onPointerDown, { capture: true })
      window.removeEventListener("pointerup", onPointerUp)
      window.removeEventListener("pointercancel", onPointerCancel)
      root.removeEventListener("click", onDisclosure, { capture: true })
    }
  }, [root, cancelFrame, cancelLocation, releaseTurnAnchor, scrollToBottom, stopFollowing])

  return { isFollowing, scrollToBottom, stopFollowing, schedulePin, contentResized, beginLocate, cancelLocation }
}
