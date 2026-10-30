import type { DriveControls } from "@alwith/module-drive/react"
import { EllipsisIcon } from "lucide-react"
import type { ReactNode } from "react"

import { NumberInput } from "@/components/alwith-ui/number-input"
import { Pane } from "@/components/alwith-ui/pane"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/alwith-ui/select"
import { Button } from "@/components/ui/button"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import "./dialog.css"

export const driveDialogClassName = "alwith-drive-dialog max-h-[80vh] overflow-auto"

export const driveControls: DriveControls = {
  NavigationScroll: ({ className, children }) => (
    <Pane className={`${className} session-list-scroll`} viewportClassName="ps-2 pe-0 pb-1">
      {children}
    </Pane>
  ),
  Button,
  Input: (props) => (props.type === "number" ? <NumberInput {...props} /> : <Input {...props} />),
  Switch,
  Menu: ({ label, children, items }): ReactNode => (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" className="alwith-drive-more-trigger" aria-label={label}>
            {children ?? <EllipsisIcon className="alwith-drive-icon" />}
          </Button>
        }
      />
      <DropdownMenuContent>
        {items.map((item) => (
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
        {items.map((item) => (
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
      onValueChange={(next) => {
        if (next !== null) onValueChange(next)
      }}
      disabled={disabled}
    >
      <SelectTrigger aria-label={label}>
        <SelectValue>{options.find((option) => option.value === value)?.label}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  ),
  Dialog: ({ open, onOpenChange, title, description, children }): ReactNode => (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={driveDialogClassName}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}
