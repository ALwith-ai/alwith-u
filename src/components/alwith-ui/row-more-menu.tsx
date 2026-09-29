/**
 * RowMoreMenu provides a shared trigger and container for the ellipsis menu shown on row/group-header hover:
 * a size-5 trigger (aligned with TrailingSwap's w-5 centerline), a size-3.5 ellipsis icon, and min-w-[160px] content.
 * Use DropdownMenuItem's built-in layout (gap-2 / svg size-4); do not add manual me-2/size styles.
 * Shared by Collection rows, Collection group headers, and Sessions rows; all new row menus should use this component.
 */
import { SquareIcon } from "lucide-react"
import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"

/** Shared trailing icon-button shape: the same size-5 centered slot as the ellipsis (TrailingSwap's w-5). */
function RowIconButton({ title, onPress, children }: { title: string; onPress: () => void; children: ReactNode }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-5"
      title={title}
      onClick={event => {
        event.stopPropagation()
        onPress()
      }}>
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
export function RowStopButton({ title, onStop }: { title: string; onStop: () => void }) {
  return (
    <RowIconButton title={title} onPress={onStop}>
      <SquareIcon className="size-3 fill-current" />
    </RowIconButton>
  )
}
