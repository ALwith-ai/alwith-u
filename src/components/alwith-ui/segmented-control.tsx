import { motion, useReducedMotion } from "motion/react"
import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import "./segmented-control.css"

type SegmentedControlItem<Value extends string> = { value: Value; label: ReactNode }

type SegmentedControlProps<Value extends string> = {
  items: readonly [SegmentedControlItem<Value>, SegmentedControlItem<Value>]
  value: Value
  onValueChange: (value: Value) => void
  "aria-label": string
  className?: string
}

/** Controlled two-option switch with an animated overlapping indicator. */
export function SegmentedControl<Value extends string>({
  items,
  value,
  onValueChange,
  "aria-label": ariaLabel,
  className
}: SegmentedControlProps<Value>) {
  const reduceMotion = useReducedMotion()
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "segmented-control relative isolate inline-grid h-9 w-54 max-w-full min-w-0 grid-cols-2 rounded-full select-none",
        className
      )}
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
        event.preventDefault()
        const rtl = getComputedStyle(event.currentTarget).direction === "rtl"
        const first = event.key === "Home" || (rtl ? event.key === "ArrowRight" : event.key === "ArrowLeft")
        onValueChange(items[first ? 0 : 1].value)
        event.currentTarget.querySelectorAll<HTMLButtonElement>("button")[first ? 0 : 1].focus()
      }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-px top-1/2 z-0 h-8.5 -translate-y-1/2 rounded-full bg-muted"
      />
      <motion.span
        aria-hidden="true"
        className="segmented-control-indicator pointer-events-none relative z-10 col-start-1 row-start-1 rounded-full border-border bg-background shadow-md"
        initial={false}
        animate={{ x: value === items[0].value ? "0%" : "calc((100% - 17px) * var(--segmented-control-direction))" }}
        transition={{ duration: reduceMotion ? 0 : 0.3, ease: [0.23, 1, 0.32, 1] }}
      />
      {items.map((item, index) => (
        <Button
          key={item.value}
          type="button"
          variant="ghost"
          aria-pressed={value === item.value}
          className={cn(
            "relative z-10 row-start-1 h-full min-w-0 rounded-full text-sm font-medium hover:bg-transparent focus-visible:border-transparent focus-visible:ring-0 active:bg-transparent aria-pressed:bg-transparent dark:hover:bg-transparent dark:active:bg-transparent",
            index === 0 ? "col-start-1 ps-11 pe-9" : "col-start-2 ps-9 pe-11",
            value === item.value ? "text-foreground" : "text-foreground/80 hover:text-foreground"
          )}
          onClick={() => {
            if (value !== item.value) onValueChange(item.value)
          }}
        >
          {item.label}
        </Button>
      ))}
    </div>
  )
}
