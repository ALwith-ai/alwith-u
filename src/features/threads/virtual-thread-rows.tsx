import { type ReactNode, useCallback, useLayoutEffect, useRef, useState } from "react"
import type { ThreadSummary } from "@/agent/client"

// Sidebar rows are 30px tall with NavigationStack's 2px gap.
const ROW_HEIGHT = 30
const ROW_STEP = 32
const OVERSCAN = 6

type RenderRow = (thread: ThreadSummary, onHoverCardOpenChange: (open: boolean) => void) => ReactNode

/** Share the sidebar viewport; groups and load-more controls retain their existing layout. */
export function VirtualThreadRows({
  threads,
  viewport,
  renderRow
}: {
  threads: ThreadSummary[]
  viewport: HTMLDivElement | null
  renderRow: RenderRow
}) {
  const root = useRef<HTMLDivElement>(null)
  const [range, setRange] = useState({ start: 0, end: OVERSCAN })
  const [cards, setCards] = useState<ReadonlySet<string>>(() => new Set())
  const [focused, setFocused] = useState<string | null>(null)
  const retainCard = useCallback((id: string, open: boolean) => {
    setCards(previous => {
      if (previous.has(id) === open) return previous
      const next = new Set(previous)
      if (open) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])
  const measure = useCallback(() => {
    if (root.current === null || viewport === null) return
    const top = viewport.getBoundingClientRect().top + viewport.clientTop - root.current.getBoundingClientRect().top
    const start = Math.max(0, Math.min(threads.length, Math.floor(top / ROW_STEP) - OVERSCAN))
    const end = Math.max(
      start,
      Math.min(threads.length, Math.ceil((top + viewport.clientHeight) / ROW_STEP) + OVERSCAN)
    )
    setRange(previous => (previous.start === start && previous.end === end ? previous : { start, end }))
  }, [threads.length, viewport])

  // A sibling group can move this list without changing its own size.
  useLayoutEffect(() => measure())
  useLayoutEffect(() => {
    if (viewport === null) return
    let frame: number | undefined
    const schedule = () => {
      if (frame !== undefined) return
      frame = requestAnimationFrame(() => {
        frame = undefined
        measure()
      })
    }
    const observer = new ResizeObserver(schedule)
    observer.observe(viewport)
    if (viewport.firstElementChild) observer.observe(viewport.firstElementChild)
    viewport.addEventListener("scroll", schedule, { passive: true })
    return () => {
      observer.disconnect()
      viewport.removeEventListener("scroll", schedule)
      if (frame !== undefined) cancelAnimationFrame(frame)
    }
  }, [measure, viewport])

  const visible = new Set<number>()
  for (let index = range.start; index < Math.min(range.end, threads.length); index++) visible.add(index)
  // Keep tab entry points and focused neighbours mounted, including when browsing by keyboard.
  if (threads.length > 0) {
    visible.add(0)
    visible.add(threads.length - 1)
  }
  threads.forEach((thread, index) => {
    if (cards.has(thread.sessionId)) visible.add(index)
    if (focused === thread.sessionId) {
      for (let neighbour = Math.max(0, index - 1); neighbour <= Math.min(threads.length - 1, index + 1); neighbour++)
        visible.add(neighbour)
    }
  })
  if (threads.length === 0) return null
  return (
    <div
      ref={root}
      data-slot="virtual-thread-rows"
      data-count={threads.length}
      className="relative w-full"
      style={{ height: threads.length * ROW_STEP - (ROW_STEP - ROW_HEIGHT) }}>
      {[...visible]
        .sort((a, b) => a - b)
        .map(index => {
          const thread = threads[index]
          return (
            <VirtualRow
              key={thread.sessionId}
              thread={thread}
              index={index}
              retainCard={retainCard}
              onFocus={setFocused}
              renderRow={renderRow}
            />
          )
        })}
    </div>
  )
}

function VirtualRow({
  thread,
  index,
  retainCard,
  onFocus,
  renderRow
}: {
  thread: ThreadSummary
  index: number
  retainCard: (id: string, open: boolean) => void
  onFocus: (id: string | null) => void
  renderRow: RenderRow
}) {
  const onCardChange = useCallback(
    (open: boolean) => retainCard(thread.sessionId, open),
    [retainCard, thread.sessionId]
  )
  return (
    <div
      data-slot="virtual-thread-row"
      className="absolute inset-x-0"
      style={{ top: index * ROW_STEP, height: ROW_HEIGHT }}
      onFocusCapture={() => onFocus(thread.sessionId)}
      onBlurCapture={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) onFocus(null)
      }}>
      {renderRow(thread, onCardChange)}
    </div>
  )
}
