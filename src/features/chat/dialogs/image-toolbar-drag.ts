import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from "react"

type Offset = { x: number; y: number }
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(Math.max(min, max), value))

/** Pointer capture keeps the grip usable when it leaves the floating toolbar. */
export function useImageToolbarDrag() {
  const toolbar = useRef<HTMLDivElement>(null)
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 })
  const position = useRef(offset)
  const active = useRef<{ id: number; x: number; y: number; offset: Offset } | null>(null)
  const update = (next: Offset) => {
    const node = toolbar.current
    if (!node) return
    const bounds = node.closest('[role="dialog"]')?.getBoundingClientRect() ?? {
      left: 0,
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight
    }
    const rect = node.getBoundingClientRect()
    const current = position.current
    const value = {
      x: clamp(next.x, current.x + bounds.left + 8 - rect.left, current.x + bounds.right - 8 - rect.right),
      y: clamp(next.y, current.y + bounds.top + 8 - rect.top, current.y + bounds.bottom - 8 - rect.bottom)
    }
    if (value.x === current.x && value.y === current.y) return
    position.current = value
    setOffset(value)
  }
  useEffect(() => {
    const node = toolbar.current
    if (!node) return
    const constrain = () => update(position.current)
    const observer = new ResizeObserver(constrain)
    observer.observe(node)
    window.addEventListener("resize", constrain)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", constrain)
    }
  }, [])
  return {
    toolbar,
    offset,
    start: (event: PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0 || active.current) return
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      active.current = { id: event.pointerId, x: event.clientX, y: event.clientY, offset: position.current }
    },
    move: (event: PointerEvent<HTMLButtonElement>) => {
      const drag = active.current
      if (drag?.id !== event.pointerId) return
      update({ x: drag.offset.x + event.clientX - drag.x, y: drag.offset.y + event.clientY - drag.y })
    },
    end: (event: PointerEvent<HTMLButtonElement>) => {
      if (active.current?.id !== event.pointerId) return
      active.current = null
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId)
    },
    keyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
      const step: Record<string, Offset> = {
        ArrowLeft: { x: -16, y: 0 },
        ArrowRight: { x: 16, y: 0 },
        ArrowUp: { x: 0, y: -16 },
        ArrowDown: { x: 0, y: 16 }
      }
      if (event.key !== "Home" && !step[event.key]) return
      event.preventDefault()
      const delta = step[event.key]
      update(
        event.key === "Home" ? { x: 0, y: 0 } : { x: position.current.x + delta.x, y: position.current.y + delta.y }
      )
    }
  }
}
