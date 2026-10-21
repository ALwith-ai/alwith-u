/**
 * Pane provides a shared scrollable panel area.
 *
 * Built on the Base UI ScrollArea primitives (same primitives and data-slot as shadcn ui/scroll-area, sharing global auto-hide CSS).
 * Scrollbars appear on hover, scroll, keyboard focus and throughout dragging. A permanent gutter keeps content clear of the track.
 * No horizontal bar is rendered, and the panel fills its parent. Use `<Pane>` for panel scroll areas.
 *
 * Using the primitives directly, instead of the ui/scroll-area wrapper, lets `viewportRef` / `onScroll` reach the actual scrolling
 * Viewport. Chat needs that element for automatic scrolling and jumping to the bottom; a simple wrapper does not expose it.
 */

import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area"
import { type ComponentProps, type Ref, type UIEventHandler, useState } from "react"

import { cn } from "@/lib/utils"

interface PaneProps extends Omit<ComponentProps<"div">, "onScroll"> {
  /** Use the platform scrollbar for continuously scrolling virtualized content. */
  nativeScroll?: boolean
  /** Access the actual Viewport element for chat's scrollIntoView / scrollTop checks. */
  viewportRef?: Ref<HTMLDivElement>
  /** The Viewport's scroll event handler. */
  onScroll?: UIEventHandler<HTMLDivElement>
  viewportClassName?: string
  /** Extra attributes forwarded to the Viewport, such as data-chat-scroll used by ChatSearch to locate the scrolling element. */
  viewportProps?: ComponentProps<"div"> & { [key: `data-${string}`]: string }
}

export function Pane({
  nativeScroll = false,
  className,
  viewportClassName,
  viewportRef,
  onScroll,
  viewportProps,
  children,
  ...props
}: PaneProps) {
  const [dragging, setDragging] = useState(false)
  if (nativeScroll)
    return (
      <div className={cn("relative flex min-h-0 flex-1", className)} {...props}>
        <div
          ref={viewportRef}
          onScroll={onScroll}
          {...viewportProps}
          className={cn(
            "min-h-0 min-w-0 flex-1 overflow-y-auto outline-none",
            viewportClassName,
            viewportProps?.className
          )}
        >
          {children}
        </div>
      </div>
    )
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("relative min-h-0 flex-1 pe-[var(--app-scrollbar-track-size)]", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        ref={viewportRef}
        onScroll={onScroll}
        data-slot="scroll-area-viewport"
        {...viewportProps}
        className={cn("size-full rounded-[inherit] pe-2 outline-none", viewportClassName, viewportProps?.className)}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar
        data-slot="scroll-area-scrollbar"
        data-orientation="vertical"
        orientation="vertical"
        data-dragging={dragging ? "" : undefined}
        onPointerDownCapture={(event) => {
          if (event.button === 0) setDragging(true)
        }}
        onPointerUpCapture={() => setDragging(false)}
        onPointerCancelCapture={() => setDragging(false)}
        onLostPointerCapture={() => setDragging(false)}
        className="flex h-full w-[var(--app-scrollbar-track-size)] touch-none px-[2px] select-none"
      >
        <ScrollAreaPrimitive.Thumb data-slot="scroll-area-thumb" className="relative flex-1 rounded-full bg-border" />
      </ScrollAreaPrimitive.Scrollbar>
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}
