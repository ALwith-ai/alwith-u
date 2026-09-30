/**
 * MenuRadioSelect: the one way a dropdown menu offers a single choice. Pass options
 * (value / label / icon / description) inside a DropdownMenuContent. From ALwith Desktop.
 */
import type { ReactNode } from "react"
import { DropdownMenuRadioGroup, DropdownMenuRadioItem } from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

export interface MenuRadioOption {
  value: string
  label: ReactNode
  icon?: ReactNode
  description?: ReactNode
  disabled?: boolean
}

export function MenuRadioSelect({
  value,
  onValueChange,
  options,
  itemClassName
}: {
  value: string
  onValueChange: (value: string) => void
  options: MenuRadioOption[]
  itemClassName?: string
}) {
  return (
    <DropdownMenuRadioGroup value={value} onValueChange={next => onValueChange(String(next))}>
      {options.map(option => (
        <DropdownMenuRadioItem
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          closeOnClick
          className={cn("gap-2", option.description ? "items-start" : "items-center", itemClassName)}>
          {option.icon}
          {option.description ? (
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium">{option.label}</div>
              <div className="text-muted-foreground text-[11px] font-normal">{option.description}</div>
            </div>
          ) : (
            <span className="min-w-0 flex-1 truncate text-start">{option.label}</span>
          )}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  )
}
