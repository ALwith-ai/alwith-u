import { PreviewCard } from "@base-ui/react/preview-card"
import type { ReactElement, ReactNode } from "react"
import "@/components/alwith-ui/codex-hover-card.css"

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
  return (
    <PreviewCard.Root open={open} onOpenChange={onOpenChange}>
      <PreviewCard.Trigger render={trigger} delay={700} closeDelay={100} />
      <PreviewCard.Portal>
        <PreviewCard.Positioner
          side={side}
          sideOffset={sideOffset}
          align={align}
          alignOffset={alignOffset}
          className="isolate z-50">
          <PreviewCard.Popup
            data-slot="codex-hover-card"
            className={
              unstyled
                ? "m-0 outline-hidden"
                : "m-px flex w-fit max-w-[min(20rem,calc(100vw-16px))] min-w-56 flex-col rounded-xl bg-[rgb(255_255_255_/_0.9)] text-sm text-[#1a1c1f] shadow-[0_0_0_0.5px_rgb(0_0_0_/_0.08),0_8px_16px_-4px_rgb(0_0_0_/_0.12)] ring-[0.5px] ring-black/8 outline-hidden backdrop-blur-sm select-none dark:bg-[rgb(33_33_33_/_0.9)] dark:text-white dark:ring-white/8"
            }>
            {unstyled ? (
              children
            ) : (
              <div className="flex w-fit max-w-[min(20rem,calc(100vw-16px))] min-w-56 flex-col gap-1 px-2 py-1.5 break-words whitespace-normal">
                {children}
              </div>
            )}
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  )
}
