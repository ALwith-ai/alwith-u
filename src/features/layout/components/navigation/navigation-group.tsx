import type { ReactElement, ReactNode } from "react"
import { OverflowMarquee } from "@/components/alwith-ui/overflow-marquee"
import { MENU_HIGHLIGHT } from "@/components/alwith-ui/surface-highlight"
import { TRAILING_GROUP, TrailingSlot, TrailingSwap } from "@/components/alwith-ui/trailing-swap"
import { NavigationLeading } from "@/features/layout/components/navigation/navigation-leading"
import { NavigationStack } from "@/features/layout/components/navigation/navigation-stack"
import { cn } from "@/lib/utils"

export function NavigationGroup({
  open,
  onOpenChange,
  tooltip,
  leading,
  label,
  count,
  active = false,
  actions,
  headerChildren,
  wrapHeader,
  onHeaderClick,
  children
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tooltip?: string
  leading?: ReactNode
  label?: ReactNode
  count?: number
  active?: boolean
  actions?: ReactNode
  headerChildren?: ReactNode
  wrapHeader?: (header: ReactElement) => ReactNode
  onHeaderClick?: () => void
  children: ReactNode
}) {
  const toggle = () => {
    onHeaderClick?.()
    onOpenChange(!open)
  }
  const rowClassName = cn(
    TRAILING_GROUP,
    "relative flex h-[var(--navigation-row-height)] w-full items-center gap-1 rounded-[10px] ps-1 pe-1.5 text-start [corner-shape:superellipse(1.5)]"
  )
  const rowContent = (
    <>
      {leading != null && <NavigationLeading>{leading}</NavigationLeading>}
      {headerChildren ?? <OverflowMarquee className="flex-1 text-sm opacity-70">{label}</OverflowMarquee>}
      <span className="relative z-10 ms-auto">
        <TrailingSwap
          content={
            count !== undefined ? (
              <TrailingSlot className="text-muted-foreground justify-end text-xs opacity-70">
                <span dir="ltr">{count}</span>
              </TrailingSlot>
            ) : undefined
          }
          actions={actions}
        />
      </span>
    </>
  )

  const header =
    headerChildren == null ? (
      <div
        data-active={active ? "" : undefined}
        title={tooltip}
        className={cn(rowClassName, MENU_HIGHLIGHT)}
        onClick={toggle}
        onKeyDown={event => {
          if (event.target !== event.currentTarget) return
          if (event.key !== "Enter" && event.key !== " ") return
          event.preventDefault()
          toggle()
        }}>
        <button
          type="button"
          aria-expanded={open}
          aria-label={typeof label === "string" ? label : tooltip}
          className="focus-visible:outline-ring absolute inset-0 rounded-[10px] outline-hidden [corner-shape:superellipse(1.5)] focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
        />
        {rowContent}
      </div>
    ) : (
      <div data-active={active ? "" : undefined} className={rowClassName}>
        {rowContent}
      </div>
    )
  return (
    <div className="text-[#1a1c1f] dark:text-white">
      {wrapHeader === undefined ? header : wrapHeader(header)}
      {open && <NavigationStack className="mt-0.5">{children}</NavigationStack>}
    </div>
  )
}
