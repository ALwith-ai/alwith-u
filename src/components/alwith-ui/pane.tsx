/**
 * Pane provides a shared scrollable panel area.
 *
 * Built on the Base UI ScrollArea primitives (same primitives and data-slot as shadcn ui/scroll-area, sharing global auto-hide CSS).
 * Scrollbars appear only on scroll/hover; no horizontal bar is rendered, and the panel fills its parent. Use `<Pane>` for panel scroll areas.
 *
 * Using the primitives directly, instead of the ui/scroll-area wrapper, lets `viewportRef` / `onScroll` reach the actual scrolling
 * Viewport. Chat needs that element for automatic scrolling and jumping to the bottom; a simple wrapper does not expose it.
 */

import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area"
import type { ComponentProps, Ref, UIEventHandler } from "react"
import { cn } from "@/lib/utils"

interface PaneProps extends Omit<ComponentProps<typeof ScrollAreaPrimitive.Root>, "onScroll"> {
  /** Access the actual Viewport element for chat's scrollIntoView / scrollTop checks. */
  viewportRef?: Ref<HTMLDivElement>
  /** The Viewport's scroll event handler. */
  onScroll?: UIEventHandler<HTMLDivElement>
  viewportClassName?: string
  /** Extra attributes forwarded to the Viewport, such as data-chat-scroll used by ChatSearch to locate the scrolling element. */
  viewportProps?: ComponentProps<"div"> & { [key: `data-${string}`]: string }
}

export function Pane({
  className,
  viewportClassName,
  viewportRef,
  onScroll,
  viewportProps,
  children,
  ...props
}: PaneProps) {
  return (
    <ScrollAreaPrimitive.Root data-slot="scroll-area" className={cn("relative min-h-0 flex-1", className)} {...props}>
      <ScrollAreaPrimitive.Viewport
        ref={viewportRef}
        onScroll={onScroll}
        data-slot="scroll-area-viewport"
        {...viewportProps}
        className={cn("size-full rounded-[inherit] outline-none", viewportClassName, viewportProps?.className)}>
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar
        data-slot="scroll-area-scrollbar"
        data-orientation="vertical"
        orientation="vertical"
        className="flex h-full w-1.5 touch-none p-px transition-colors select-none">
        <ScrollAreaPrimitive.Thumb data-slot="scroll-area-thumb" className="bg-border relative flex-1 rounded-full" />
      </ScrollAreaPrimitive.Scrollbar>
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}
