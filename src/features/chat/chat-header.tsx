import type { ReactNode } from "react"
import { createPortal } from "react-dom"

import { OverflowMarquee } from "@/components/alwith-ui/overflow-marquee"
import { cn } from "@/lib/utils"

/** The floating surface supplies its top bar; the main surface keeps its own header. */
export function ChatHeader({
  target,
  title,
  project,
  children
}: {
  target?: HTMLElement | null
  title: string
  project?: ReactNode
  children: ReactNode
}) {
  const floating = target !== undefined
  const content = (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-1.5" data-tauri-drag-region>
        {project}
        <OverflowMarquee
          className={cn(
            "block min-w-0 text-sm font-medium select-none [&>span]:pointer-events-none",
            floating ? "max-w-[50vw]" : "flex-1"
          )}
          data-tauri-drag-region
        >
          {title}
        </OverflowMarquee>
      </div>
      {children}
    </>
  )
  if (floating) return target === null ? null : createPortal(content, target)
  return (
    <header
      className="@container relative flex min-h-10 shrink-0 flex-wrap items-center gap-1 border-b border-border ps-1 pe-6"
      data-main-chat-header
      data-tauri-drag-region
    >
      {content}
    </header>
  )
}
