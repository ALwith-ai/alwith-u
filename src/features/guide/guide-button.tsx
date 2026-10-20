import { CircleHelpIcon, KeyboardIcon, LifeBuoyIcon } from "lucide-react"
import { type ReactNode, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { useSidebarOverlay } from "@/components/alwith-ui/sidebar-overlay-context"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { HotkeysDialog } from "@/features/settings/hotkeys-dialog"

import { openGuideWindow } from "./guide-window"

export function GuideButton(): ReactNode {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const [menuWidth, setMenuWidth] = useState<number>()
  const [hotkeysOpen, setHotkeysOpen] = useState(false)
  useSidebarOverlay(open)
  return (
    <>
      <DropdownMenu
        open={open}
        onOpenChange={(next) => {
          if (next) {
            const row = trigger.current?.parentElement
            if (!row) throw new Error("Help trigger must be mounted in its footer row")
            setMenuWidth(row.clientWidth)
          }
          setOpen(next)
        }}
      >
        <DropdownMenuTrigger
          render={
            <Button
              ref={trigger}
              variant="ghost"
              size="icon-sm"
              className="shrink-0 rounded-[10px] [corner-shape:superellipse(1.5)]"
              aria-label={t("guide.help")}
              title={t("guide.help")}
            />
          }
        >
          <CircleHelpIcon className="size-4 shrink-0" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" sideOffset={8} style={{ width: menuWidth }}>
          <DropdownMenuItem className="h-8 py-0" onClick={() => setHotkeysOpen(true)}>
            <KeyboardIcon className="text-muted-foreground" />
            {t("shortcuts.title")}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="h-8 py-0"
            onClick={() =>
              void openGuideWindow().catch((error: unknown) =>
                toast.error(error instanceof Error ? error.message : String(error))
              )
            }
          >
            <LifeBuoyIcon className="text-muted-foreground" />
            {t("guide.userGuide")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <HotkeysDialog open={hotkeysOpen} onOpenChange={setHotkeysOpen} />
    </>
  )
}
