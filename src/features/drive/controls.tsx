import type { DriveControls } from "@alwith/module-drive/react"
import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export const driveControls: DriveControls = {
  Button,
  Input,
  Switch,
  Menu: ({ label, children, items }): ReactNode => (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label={label}>
            {children ?? "⋯"}
          </Button>
        }
      />
      <DropdownMenuContent>
        {items.map(item => (
          <DropdownMenuItem key={item.label} disabled={item.disabled} onClick={item.onSelect}>
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  ),
  ContextMenu: ({ children, items }): ReactNode => (
    <ContextMenu>
      <ContextMenuTrigger>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        {items.map(item => (
          <ContextMenuItem key={item.label} disabled={item.disabled} onClick={item.onSelect}>
            {item.label}
          </ContextMenuItem>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  ),
  Select: ({ value, onValueChange, options, disabled, "aria-label": label }): ReactNode => (
    <Select
      value={value}
      onValueChange={next => {
        if (next !== null) onValueChange(next)
      }}
      disabled={disabled}>
      <SelectTrigger aria-label={label}>
        <SelectValue>{options.find(option => option.value === value)?.label}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map(option => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  ),
  Dialog: ({ open, onOpenChange, title, description, children }): ReactNode => (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}
