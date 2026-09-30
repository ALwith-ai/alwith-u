/**
 * Custom resize edges for undecorated windows. On macOS, tao 0.35.3's drag_resize_window (the frontend's
 * startResizeDragging) returns NotSupported (tao-0.35.3/src/platform_impl/macos/window.rs:963).
 * Native resizing only works within a very narrow edge hit area on borderless+Resizable windows, so on macOS this component
 * tracks the pointer with pointer capture and calls resize_window_edge each frame to update bounds atomically (Rust clamps min/max sizes).
 * Other platforms support startResizeDragging and delegate directly to the system.
 * Hit areas: 8px on each edge (wider areas would intercept nearby controls, such as the chat scrollbar) and 16px at each corner.
 * Resizes the entire window only; does not resize split panes.
 * Shared by full and mini chat windows.
 */

import { invoke } from "@tauri-apps/api/core"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { platform } from "@tauri-apps/plugin-os"
import { type PointerEvent as ReactPointerEvent, useEffect, useRef } from "react"

// @tauri-apps/api does not export ResizeDirection; infer it from the method signature.
type ResizeDirection = Parameters<ReturnType<typeof getCurrentWindow>["startResizeDragging"]>[0]

// One queue per WebView; remounting between full and mini modes must still wait for the previous in-flight resize request.
let pendingResize = Promise.resolve()

function dragResizeMacos(direction: ResizeDirection, event: ReactPointerEvent<HTMLDivElement>): () => void {
  const win = getCurrentWindow()
  const target = event.currentTarget
  const { pointerId, screenX: startX, screenY: startY } = event
  const listeners = new AbortController()
  let ended = false
  let cancelled = false
  const movement: { latest: { x: number; y: number } | null } = { latest: null }
  let lastX = startX
  let lastY = startY
  let wake: (() => void) | null = null
  const finish = (cancel: boolean) => {
    if (cancel) {
      cancelled = true
      movement.latest = null
    }
    if (!ended) {
      ended = true
      listeners.abort()
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId)
    }
    wake?.()
  }
  const update = (pointer: PointerEvent) => {
    if (pointer.screenX === lastX && pointer.screenY === lastY) return
    lastX = pointer.screenX
    lastY = pointer.screenY
    movement.latest = { x: lastX, y: lastY }
    wake?.()
  }
  const onMove = (pointer: PointerEvent) => {
    if (pointer.pointerId !== pointerId) return
    if ((pointer.buttons & 1) === 0) {
      finish(true)
      return
    }
    update(pointer)
  }
  const onUp = (pointer: PointerEvent) => {
    if (pointer.pointerId !== pointerId) return
    update(pointer)
    finish(false)
  }
  const onCancel = (pointer: PointerEvent) => {
    if (pointer.pointerId === pointerId) finish(true)
  }
  // Register end-event listeners before any await, or a quick release could leave listeners that keep changing window bounds.
  const options = { signal: listeners.signal }
  window.addEventListener("pointermove", onMove, options)
  window.addEventListener("pointerup", onUp, options)
  window.addEventListener("pointercancel", onCancel, options)
  window.addEventListener("blur", () => finish(true), options)
  target.addEventListener("lostpointercapture", onCancel, options)
  target.setPointerCapture(pointerId)

  const previous = pendingResize
  let release!: () => void
  pendingResize = new Promise<void>(resolve => {
    release = resolve
  })
  void (async () => {
    try {
      await previous
      if (ended) return
      const [position, size, scaleFactor] = await Promise.all([win.outerPosition(), win.outerSize(), win.scaleFactor()])
      if (ended) return
      const west = direction.includes("West")
      const north = direction.includes("North")
      const east = direction.includes("East")
      const south = direction.includes("South")
      // Keep only the latest coordinates while a command is in flight; release flushes the final frame, while cancellation or a new drag discards unsent targets.
      while (!cancelled) {
        if (movement.latest === null) {
          if (ended) return
          await new Promise<void>(resolve => {
            wake = resolve
          })
          wake = null
          continue
        }
        const point = movement.latest
        movement.latest = null
        // Absolute screen coordinates remain stable as bounds change each frame; sample the next starting bounds only after serialized resize requests finish.
        const dx = Math.round((point.x - startX) * scaleFactor)
        const dy = Math.round((point.y - startY) * scaleFactor)
        await invoke("resize_chat_window", {
          direction,
          x: position.x + (west ? dx : 0),
          y: position.y + (north ? dy : 0),
          width: size.width + (east ? dx : west ? -dx : 0),
          height: size.height + (south ? dy : north ? -dy : 0)
        })
      }
    } finally {
      finish(true)
      release()
    }
  })()
  return () => finish(true)
}

export function WindowResizeEdges({ vertical = true }: { vertical?: boolean }) {
  const cancelResize = useRef<(() => void) | null>(null)
  useEffect(() => () => cancelResize.current?.(), [])
  const start = (direction: ResizeDirection) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    if (platform() === "macos") {
      cancelResize.current?.()
      cancelResize.current = dragResizeMacos(direction, e)
    } else {
      void getCurrentWindow().startResizeDragging(direction)
    }
  }
  return (
    <>
      <div className="absolute inset-y-0 left-0 z-50 w-2 cursor-ew-resize" onPointerDown={start("West")} />
      <div className="absolute inset-y-0 right-0 z-50 w-2 cursor-ew-resize" onPointerDown={start("East")} />
      {vertical && (
        <>
          <div className="absolute inset-x-0 top-0 z-50 h-2 cursor-ns-resize" onPointerDown={start("North")} />
          <div className="absolute inset-x-0 bottom-0 z-50 h-2 cursor-ns-resize" onPointerDown={start("South")} />
          <div className="absolute top-0 left-0 z-50 size-4 cursor-nwse-resize" onPointerDown={start("NorthWest")} />
          <div className="absolute top-0 right-0 z-50 size-4 cursor-nesw-resize" onPointerDown={start("NorthEast")} />
          <div
            className="absolute right-0 bottom-0 z-50 size-4 cursor-nwse-resize"
            onPointerDown={start("SouthEast")}
          />
          <div className="absolute bottom-0 left-0 z-50 size-4 cursor-nesw-resize" onPointerDown={start("SouthWest")} />
        </>
      )}
    </>
  )
}
