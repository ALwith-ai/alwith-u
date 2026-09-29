/**
 * HoverInfoCard provides a shared content layout for hover cards. Session rows (left navigation / Collection / Activity /
 * session columns) and the chat turn ruler share a one-line title, optional body, and rows of an icon plus one line of text.
 *
 * Only layout is shared: callers choose titles and row counts; spacing, font sizes, and icon column widths are defined here.
 *
 * `actions` moved here from the row's trailing ellipsis menu (user decision, 2026-07-27). Render a vertical list of icons with labels,
 * not a row of icon buttons: action counts vary (3 in session columns, 5 in Collection session rows), making icon rows crowded.
 * Icons alone cannot distinguish actions such as "Move to group" and "Remove from group". The trailing slot is reserved for ✕ (stop session).
 */
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export interface HoverInfoRow {
  icon: ReactNode
  text: ReactNode
}

export function HoverInfoCard({
  title,
  titleIcon,
  body,
  rows,
  details,
  actions
}: {
  title: ReactNode
  titleIcon?: ReactNode
  body?: ReactNode
  rows?: HoverInfoRow[]
  details?: HoverInfoRow[]
  /** Actions at the bottom of the card, separated from the information by a divider; omit the divider when no actions exist. */
  actions?: ReactNode
}) {
  return (
    <div data-slot="hover-info-card" className="flex flex-col gap-1.5">
      <div data-slot="hover-info-card-summary" className="flex min-w-0 flex-col gap-1">
        <div data-slot="hover-info-card-title-row" className="flex min-w-0 items-center gap-1.5">
          {titleIcon != null && (
            <span data-slot="hover-info-card-icon" className="flex h-5 w-4 shrink-0 items-center justify-center">
              {titleIcon}
            </span>
          )}
          <div
            data-slot="hover-info-card-title"
            className="text-foreground line-clamp-2 min-w-0 flex-1 text-sm break-words">
            {title}
          </div>
        </div>
        {body != null && (
          <div data-slot="hover-info-card-body" className="text-muted-foreground line-clamp-2 text-xs break-words">
            {body}
          </div>
        )}
        <HoverInfoRows rows={rows} />
      </div>
      {details != null && details.length > 0 && (
        <div data-slot="hover-info-card-details" className="flex min-w-0 flex-col gap-1.5">
          <HoverInfoRows rows={details} />
        </div>
      )}
      {actions != null && (
        <>
          <div data-slot="hover-info-card-separator" className="bg-border -mx-3 mt-1.5 h-px" />
          <div data-slot="hover-info-card-actions" className="-mx-1 flex flex-col">
            {actions}
          </div>
        </>
      )}
    </div>
  )
}

function HoverInfoRows({ rows }: { rows?: HoverInfoRow[] }) {
  return rows?.map((row, index) => (
    // These presentation-only rows have no stable IDs; their order defines their identity.
    // biome-ignore lint/suspicious/noArrayIndexKey: Static presentation rows have a fixed order and are never reordered.
    <div key={index} data-slot="hover-info-card-row" className="text-muted-foreground flex items-start gap-1.5 text-xs">
      <span data-slot="hover-info-card-icon" className="flex h-5 w-4 shrink-0 items-center justify-center">
        {row.icon}
      </span>
      <span className="min-w-0 break-all">{row.text}</span>
    </div>
  ))
}

/**
 * An action at the bottom of the card, matching DropdownMenuItem layout (h-8 / gap-2 / svg size-4).
 * Use a regular button: the card is already a floating layer, and nesting a menu would create conflicting dismissal behavior.
 */
export function HoverInfoAction({
  icon,
  label,
  trailing,
  disabled,
  onClick,
  variant = "default"
}: {
  icon: ReactNode
  label: ReactNode
  /** Optional trailing content, such as the ▾ for "Move to group". */
  trailing?: ReactNode
  disabled?: boolean
  onClick?: () => void
  variant?: "default" | "destructive"
}) {
  return (
    <button
      data-slot="hover-info-card-action"
      data-variant={variant}
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "text-foreground hover:bg-foreground/5 active:bg-foreground/10 flex h-8 w-full items-center gap-2 rounded-sm px-2 text-start text-sm disabled:pointer-events-none disabled:opacity-50",
        "[&_svg]:size-4 [&_svg]:shrink-0",
        variant === "destructive" ? "text-destructive [&_svg]:text-destructive" : "[&_svg]:text-muted-foreground"
      )}>
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
    </button>
  )
}
