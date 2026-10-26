import type { ComponentProps } from "react"

import { SelectContent as ShadcnSelectContent } from "@/components/ui/select"
import { cn } from "@/lib/utils"

export { Select, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

/** Menus open below their trigger with a stable anchor width across app surfaces. */
export function SelectContent({ className, ...props }: ComponentProps<typeof ShadcnSelectContent>) {
  return (
    <ShadcnSelectContent
      align="start"
      alignItemWithTrigger={false}
      sideOffset={6}
      {...props}
      className={cn("max-w-(--available-width) min-w-0 p-1", className)}
    />
  )
}
