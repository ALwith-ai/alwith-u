/**
 * Shared trailing-area geometry for GroupHeader and SessionItem (pure CSS, no absolute positioning).
 * Three concepts keep callers from assembling their own geometry:
 *
 * 1. `TRAILING_GROUP`: group class on the host row container (Tailwind variants require static literals).
 * 2. `TrailingSlot`: the rightmost w-5 centered slot, matching icon-button width (size-5) with centered content.
 *    Dots, counts, and ellipsis icons share a vertical centerline; wide content such as count 106 overflows symmetrically.
 * 3. `TrailingSwap`: the default content stays in normal flow; hover actions are absolutely positioned over the same right edge.
 *    Actions do not affect sizing. Toggle display directly, bypassing child buttons' transition-all; while the menu is open
 *    (data-popup-open), actions remain visible and default content stays hidden. Action clicks do not bubble to the row.
 */
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/** Required group class on the host row container, paired with the group-hover/trailing variants below. */
export const TRAILING_GROUP = "group/trailing"

/** Rightmost w-5 centered slot, aligned with icon-button glyphs; empty children reserve the slot to prevent shifting. */
export function TrailingSlot({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <span className={cn("flex w-5 shrink-0 items-center justify-center whitespace-nowrap", className)}>{children}</span>
  )
}

export function TrailingSwap({
  content,
  actions,
  className
}: {
  /** Default layer (dot / time / count); wrap the rightmost element in TrailingSlot to align its center. */
  content?: ReactNode
  /** Hover layer (ellipsis / ✕ icon buttons); this component owns swapping, overlap prevention, and stopPropagation. */
  actions?: ReactNode
  className?: string
}) {
  if (content == null && actions == null) return null
  return (
    <span className={cn("group/swap relative flex min-h-5 min-w-5 shrink-0 items-center justify-end", className)}>
      {content != null && (
        <span
          className={cn(
            "flex items-center justify-end",
            actions != null && "group-hover/trailing:hidden group-has-[[data-popup-open]]/swap:hidden"
          )}>
          {content}
        </span>
      )}
      {actions != null && (
        <span
          className="absolute inset-y-0 end-0 hidden w-max items-center justify-end gap-0.5 group-hover/trailing:flex has-[[data-popup-open]]:flex"
          onClick={e => e.stopPropagation()}
          onKeyDown={e => e.stopPropagation()}>
          {actions}
        </span>
      )}
    </span>
  )
}
