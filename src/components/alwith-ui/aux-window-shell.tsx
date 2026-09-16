// Shell of auxiliary windows, reduced from ALwith Desktop's aux-window-shell: the sidebar
// form (the sidebar fills the window height, the traffic lights float over it, a hairline
// separates it from the content; header and footer belong to the right column).
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { XIcon } from "lucide-react"
import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const IS_WINDOWS = /Win/.test(navigator.platform)

/** Windows: no native decorations on tool windows, so close is drawn here (close is
 *  intercepted into hide by the page, keeping the semantics). */
function WindowsAuxControls() {
  const { t } = useTranslation()
  if (!IS_WINDOWS) return null
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={t("actions.close")}
      onClick={() => void getCurrentWebviewWindow().close()}>
      <XIcon />
    </Button>
  )
}

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
          <WindowsAuxControls />
        </div>
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </div>
    </div>
  )
}
