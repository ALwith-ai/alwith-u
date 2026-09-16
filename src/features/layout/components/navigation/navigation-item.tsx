import type { ComponentProps } from "react"
import { cn } from "@/lib/utils"

export function NavigationItem({ className, ...props }: ComponentProps<"li">) {
  return <li className={cn("relative", className)} {...props} />
}

export function NavigationItemButton({ active, className, ...props }: ComponentProps<"button"> & { active?: boolean }) {
  return (
    <button
      type="button"
      data-active={active ? "" : undefined}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group/navigation-row focus-visible:outline-ring flex h-[var(--navigation-row-height)] w-full items-center gap-1 overflow-hidden rounded-[10px] ps-1 pe-1.5 text-start text-sm outline-hidden [corner-shape:superellipse(1.5)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&>span:last-child]:truncate",
        className
      )}
      {...props}
    />
  )
}
