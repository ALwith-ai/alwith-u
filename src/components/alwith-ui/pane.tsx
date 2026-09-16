/**
 * Pane — 统一的可滚动面板区域。
 *
 * 基于 Base UI ScrollArea 基元(跟 shadcn ui/scroll-area 同一套、同 data-slot,共用全局 auto-hide CSS):
 * 自动隐藏滚动条(滚动/hover 才浮现)、不渲染横向条、撑满父容器。各面板滚动区直接用 `<Pane>`。
 *
 * 直接用基元(而非 ui/scroll-area 包装)是为了把 `viewportRef` / `onScroll` 透传到真正滚动的
 * Viewport —— 聊天区要拿滚动元素做「自动滚到底 / 回到底部」,简单包装拿不到。
 */

import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area"
import type { ComponentProps, Ref, UIEventHandler } from "react"
import { cn } from "@/lib/utils"

interface PaneProps extends Omit<ComponentProps<typeof ScrollAreaPrimitive.Root>, "onScroll"> {
  /** 拿到真正滚动的 Viewport 元素(聊天区做 scrollIntoView / scrollTop 检测用)。 */
  viewportRef?: Ref<HTMLDivElement>
  /** Viewport 的滚动事件。 */
  onScroll?: UIEventHandler<HTMLDivElement>
  viewportClassName?: string
  /** 透传到 Viewport 的额外属性(data-* 等,如 ChatSearch 找滚动元素的 data-chat-scroll)。 */
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
        className="flex h-full w-2.5 touch-none border-s border-s-transparent p-px transition-colors select-none">
        <ScrollAreaPrimitive.Thumb data-slot="scroll-area-thumb" className="bg-border relative flex-1 rounded-full" />
      </ScrollAreaPrimitive.Scrollbar>
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}
