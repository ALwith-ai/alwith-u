/**
 * RowMoreMenu provides a shared trigger and container for the ellipsis menu shown on row/group-header hover:
 * a size-5 trigger (aligned with TrailingSwap's w-5 centerline), a size-3.5 ellipsis icon, and min-w-[160px] content.
 * Use DropdownMenuItem's built-in layout (gap-2 / svg size-4); do not add manual me-2/size styles.
 * Shared by Collection rows, Collection group headers, and Sessions rows; all new row menus should use this component.
 */
import { SquareIcon } from "lucide-react"
import { type ReactNode, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"

/** Shared trailing icon-button shape: the same size-5 centered slot as the ellipsis (TrailingSwap's w-5). */
function RowIconButton({
  title,
  onPress,
  children,
  pending
}: {
  title: string
  onPress: () => void
  children: ReactNode
  pending: boolean
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-5"
      title={title}
      aria-label={title}
      aria-busy={pending}
      disabled={pending}
      onKeyDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        onPress()
      }}
    >
      {children}
    </Button>
  )
}

/**
 * Trailing stop button: a square, not ✕.
 *
 * The action must stop, not release (user requested "turn off the green light", 2026-07-27): releaseSession only releases this window's reference;
 * the agent keeps running and its light stays on, contrary to user expectations. Show this button only while the session is actually live.
 * Inactive sessions on disk have nothing to stop; keep displaying the time in that slot.
 */
export function RowStopButton({ title, onStop }: { title: string; onStop: () => Promise<void> }) {
  const [pending, setPending] = useState(false)
  const inflight = useRef(false)
  const stop = async () => {
    if (inflight.current) return
    inflight.current = true
    setPending(true)
    try {
      await onStop()
    } finally {
      inflight.current = false
      setPending(false)
    }
  }
  return (
    <RowIconButton title={title} onPress={() => void stop()} pending={pending}>
      {pending ? <Spinner className="size-3" aria-label={title} /> : <SquareIcon className="size-3 fill-current" />}
    </RowIconButton>
  )
}
