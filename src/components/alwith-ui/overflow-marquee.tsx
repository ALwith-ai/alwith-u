import { type ComponentProps, useRef, useState } from "react"
import { cn } from "@/lib/utils"

/** Marquee speed in px/s, comparable to macOS Finder. */
const MARQUEE_SPEED = 45
/** Do not scroll below this overflow threshold, avoiding jitter over short distances. */
const MARQUEE_MIN_OVERFLOW = 8

/** On hover, scroll a single line to its end only when it actually overflows. */
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
