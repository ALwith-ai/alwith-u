import { type ComponentProps, useRef, useState } from "react"
import { cn } from "@/lib/utils"

/** 走马灯速度(px/s)。跟 macOS Finder 一个量级。 */
const MARQUEE_SPEED = 45
/** 溢出不到这么多像素就不滚，避免短距离晃动。 */
const MARQUEE_MIN_OVERFLOW = 8

/** 单行内容仅在真实溢出时悬停滚到末尾。 */
export function OverflowMarquee({ className, children, onMouseEnter, onMouseLeave, ...props }: ComponentProps<"span">) {
  const textRef = useRef<HTMLSpanElement | null>(null)
  const [translation, setTranslation] = useState(0)

  return (
    <span
      className={cn("min-w-0 overflow-hidden", className)}
      onMouseEnter={event => {
        const node = textRef.current
        if (!node) return
        const overflow = node.scrollWidth - node.clientWidth
        if (overflow > MARQUEE_MIN_OVERFLOW) {
          setTranslation(getComputedStyle(node).direction === "rtl" ? overflow : -overflow)
        }
        onMouseEnter?.(event)
      }}
      onMouseLeave={event => {
        setTranslation(0)
        onMouseLeave?.(event)
      }}
      {...props}>
      <span
        ref={textRef}
        className={cn("block whitespace-nowrap", translation === 0 ? "truncate" : "overflow-visible")}
        style={{
          transform: `translateX(${translation}px)`,
          transition: `transform ${Math.abs(translation) / MARQUEE_SPEED}s linear`
        }}>
        {children}
      </span>
    </span>
  )
}
