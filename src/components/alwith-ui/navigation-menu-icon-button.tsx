import type { ComponentProps } from "react"
import { MENU_HIGHLIGHT } from "@/components/alwith-ui/surface-highlight"
import { cn } from "@/lib/utils"

export function NavigationMenuIconButton({
  active,
  expanded = false,
  highlight = true,
  className,
  ...props
}: ComponentProps<"button"> & { active?: boolean; expanded?: boolean; highlight?: boolean }) {
  return (
    <button
      type="button"
      data-active={active ? "" : undefined}
      aria-current={active ? "page" : undefined}
      className={cn(
        highlight && MENU_HIGHLIGHT,
        "focus-visible:outline-foreground/10 flex shrink-0 items-center justify-center rounded-[10px] outline-hidden [corner-shape:superellipse(1.5)] focus-visible:outline-2 focus-visible:outline-offset-2 [&_svg]:size-4",
        expanded
          ? "h-[var(--navigation-row-height)] min-w-[var(--navigation-row-height)]"
          : "size-[var(--navigation-row-height)]",
        className
      )}
      {...props}
    />
  )
}
