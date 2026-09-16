import type { ComponentProps } from "react"
import { cn } from "@/lib/utils"

export function NavigationLeading({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="navigation-leading"
      className={cn("flex size-6 shrink-0 items-center justify-center [&_.lucide]:size-3.5", className)}
      {...props}
    />
  )
}
