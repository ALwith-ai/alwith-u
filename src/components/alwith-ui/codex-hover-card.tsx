import { PreviewCard } from "@base-ui/react/preview-card"
import type { ReactElement, ReactNode } from "react"
import "@/components/alwith-ui/codex-hover-card.css"
import { useSidebarOverlay } from "./sidebar-overlay-context"

type Position = Pick<PreviewCard.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset">

export function CodexHoverCard({
  open,
  onOpenChange,
  trigger,
  children,
  side = "inline-end",
  sideOffset = 2,
  align = "start",
  alignOffset,
  unstyled = false
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: ReactElement
  children: ReactNode
  unstyled?: boolean
} & Position) {
  useSidebarOverlay(open)
  return (
    <PreviewCard.Root open={open} onOpenChange={onOpenChange}>
      <PreviewCard.Trigger render={trigger} delay={700} closeDelay={100} />
      <PreviewCard.Portal>
        <PreviewCard.Positioner
          side={side}
          sideOffset={sideOffset}
          align={align}
          alignOffset={alignOffset}
          className="isolate z-50"
        >
          <PreviewCard.Popup
            data-slot="codex-hover-card"
            className={
              unstyled
                ? "m-0 outline-hidden"
                : "m-px flex w-80 max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-md bg-popover text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden select-none"
            }
          >
            {unstyled ? (
              children
            ) : (
              <div className="flex w-full min-w-0 flex-col px-0 py-1 break-words whitespace-normal">{children}</div>
            )}
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  )
}
