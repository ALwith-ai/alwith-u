// Shell of auxiliary windows, reduced from ALwith Desktop's aux-window-shell: the sidebar
// form (the sidebar fills the window height, the traffic lights float over it, a hairline
// separates it from the content; header and footer belong to the right column).
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export function AuxWindowShell({
  title,
  sidebar,
  sidebarClassName,
  className,
  children
}: {
  title?: ReactNode
  sidebar: ReactNode
  sidebarClassName?: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn("bg-background flex h-screen", className)}>
      <aside className={cn("bg-sidebar border-border flex shrink-0 flex-col border-e", sidebarClassName)}>
        {/* Traffic-light clearance + the sidebar's drag strip. */}
        <div className="h-8 shrink-0" data-tauri-drag-region />
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{sidebar}</div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="relative flex h-8 shrink-0 items-center gap-1 ps-2 pe-2" data-tauri-drag-region>
          {title && (
            <span className="text-muted-foreground absolute start-1/2 -translate-x-1/2 text-[13px] font-semibold rtl:translate-x-1/2">
              {title}
            </span>
          )}
          <div className="h-full flex-1" data-tauri-drag-region />
        </div>
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </div>
    </div>
  )
}
