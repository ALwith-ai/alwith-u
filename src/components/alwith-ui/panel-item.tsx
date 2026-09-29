/**
 * Shared wrapper for sidebar panel list items.
 *
 * Centralizes the common list-item settings previously tuned separately in the sessions / extensions / plugins / search panels:
 * size="xs", horizontal padding (px-2.5), hover styles, rounded corners, and single-line title truncation.
 * Updating all four panels now means editing this file. Each panel composes its own media / actions / description slots.
 *
 * Re-exports shadcn Item subcomponents (ItemMedia/ItemContent/ItemActions/ItemDescription/ItemTitle).
 * Compose special titles, such as a search file header with name and directory on one line, with ItemTitle; use PanelItemTitle for standard truncation.
 */

import type { ComponentProps } from "react"
import { OverflowMarquee } from "@/components/alwith-ui/overflow-marquee"
import { ROW_HIGHLIGHT } from "@/components/alwith-ui/surface-highlight"
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item"
import { cn } from "@/lib/utils"

/** List container with px-2 horizontal margins, aligned with panel headings and inset from the window edge. */
function PanelList({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-col px-2", className)} {...props} />
}

/**
 * List item: a flat shadcn Item with size="xs" and hover styles by default. The size can be overridden.
 * Pass active to highlight selection, matching navigation item selection:
 * selection and hover share bg-accent, with text-accent-foreground and font-medium distinguishing selection.
 */
function PanelItem({ className, size = "xs", active, ...props }: ComponentProps<typeof Item> & { active?: boolean }) {
  return (
    <Item
      size={size}
      data-active={active}
      className={cn(
        // Use the Item base class's rounded-md: without the sidebar glass panel, hover/selection appears as a standalone highlight
        // over the window background; a full-width square strip would look cut off (user correction, 2026-07-26, matching Codex).
        // Background values are defined once in surface-highlight.ts and shared with sidebar menu buttons.
        ROW_HIGHLIGHT,
        "data-[active=true]:font-medium",
        className
      )}
      {...props}
    />
  )
}

/**
 * Standard title: ItemTitle with an inner single-line ellipsis.
 *
 * Hover marquee: measure on pointer entry and scroll only if text overflows, stopping as soon as the end is visible (distance =
 * overflow amount). Scroll back on pointer leave. Constant speed means longer titles take longer to scroll.
 *
 * Libraries such as `react-fast-marquee` loop continuously by duplicating content for seamless scrolling,
 * which would show repeated titles in a truncated heading. We need Finder / Spotify behavior: reveal the end, then return.
 * Those looping libraries do not match this behavior.
 */
function PanelItemTitle({ className, children, ...props }: ComponentProps<typeof ItemTitle>) {
  return (
    <ItemTitle className={cn("w-full", className)} {...props}>
      <OverflowMarquee>{children}</OverflowMarquee>
    </ItemTitle>
  )
}

export {
  // Bare Item: compose special cases without default hover styles, such as session group headers.
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
  PanelItem,
  PanelItemTitle,
  PanelList
}
