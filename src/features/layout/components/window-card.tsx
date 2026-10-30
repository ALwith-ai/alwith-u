import { MinusIcon, SquareIcon, XIcon } from "lucide-react"
import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { isMac } from "@/lib/platform"
import { cn } from "@/lib/utils"

/** Desktop's miniature window proportions, with native button keyboard behavior. */
export function WindowCard({
  title,
  icon,
  onOpen,
  onClose,
  badge
}: {
  title: string
  icon: ReactNode
  onOpen: () => void
  onClose?: () => void
  badge?: ReactNode
}) {
  const { t } = useTranslation()
  const mac = isMac()
  const trigger = (
    <Button
      variant="ghost"
      className="window-card-hit absolute inset-0 h-full w-full cursor-pointer rounded-[inherit] border-0 p-0 font-normal hover:bg-transparent dark:hover:bg-transparent"
      aria-label={title}
      onClick={onOpen}
    >
      <span className="pointer-events-none flex h-full w-full items-center justify-center [&_img]:size-12 [&_svg]:size-12">
        {icon}
      </span>
      <span className="pointer-events-none absolute inset-x-2.5 bottom-1.5 truncate text-start text-xs text-foreground/70">
        {title}
      </span>
    </Button>
  )
  return (
    <div
      data-pane-feedback-frame
      className="window-card group relative aspect-[16/10] shrink-0 overflow-clip rounded-xl border border-border bg-background text-foreground"
    >
      {trigger}
      {badge}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-2 flex items-center gap-1.5",
          mac ? "left-2.5" : "right-2.5 text-muted-foreground"
        )}
      >
        {mac ? (
          <>
            <span className="window-card-close-dot size-2.5 shrink-0 rounded-full" />
            <span className="window-card-minimize-dot size-2.5 shrink-0 rounded-full" />
            <span className="window-card-maximize-dot size-2.5 shrink-0 rounded-full" />
          </>
        ) : (
          <>
            <MinusIcon className="size-3" strokeWidth={1} />
            <SquareIcon className="size-2.5" strokeWidth={1} />
            <XIcon className="size-3" strokeWidth={1} />
          </>
        )}
      </span>
      {onClose && (
        <Button
          variant="ghost"
          size="icon-xs"
          className={cn(
            "absolute top-1 z-10 cursor-pointer opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100",
            mac ? "right-1" : "left-1"
          )}
          aria-label={t("actions.close")}
          title={t("actions.close")}
          onClick={onClose}
        >
          <XIcon className="size-4" />
        </Button>
      )}
    </div>
  )
}
