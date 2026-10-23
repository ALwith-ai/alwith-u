import type { ComponentProps, ReactElement, ReactNode } from "react"

import { Kbd } from "@/components/ui/kbd"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { displayShortcut } from "@/lib/shortcut-formatter"

export function ShortcutKey({ shortcut, ...props }: { shortcut: string } & ComponentProps<typeof Kbd>) {
  return shortcut ? (
    <Kbd aria-hidden="true" {...props}>
      {displayShortcut(shortcut)}
    </Kbd>
  ) : null
}

/** Keep the action label and its keyboard badge visually distinct in every surface. */
export function ShortcutHint({ label, shortcut }: { label: ReactNode; shortcut: string }) {
  return (
    <>
      <span className="min-w-0">{label}</span>
      <ShortcutKey className="shrink-0" shortcut={shortcut} aria-hidden="false" />
    </>
  )
}

export function ShortcutTooltip({
  label,
  shortcut,
  children
}: {
  label: ReactNode
  shortcut: string
  children: ReactElement
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent role="tooltip">
        <ShortcutHint label={label} shortcut={shortcut} />
      </TooltipContent>
    </Tooltip>
  )
}
