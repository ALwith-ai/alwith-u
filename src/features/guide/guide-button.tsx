import { CircleHelpIcon, KeyboardIcon, LifeBuoyIcon } from "lucide-react"
import { type ReactNode, useState } from "react"
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
  const [hotkeysOpen, setHotkeysOpen] = useState(false)
  useSidebarOverlay(open)
  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0"
              aria-label={t("guide.help")}
              title={t("guide.help")}
            />
          }>
          <CircleHelpIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" sideOffset={8} className="w-60 rounded-2xl p-2 shadow-lg ring-0">
          <DropdownMenuItem className="h-10 gap-3 rounded-lg px-2 [&_svg]:size-5" onClick={() => setHotkeysOpen(true)}>
            <KeyboardIcon className="text-muted-foreground" />
            {t("shortcuts.title")}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="h-10 gap-3 rounded-lg px-2 [&_svg]:size-5"
            onClick={() =>
              void openGuideWindow().catch((error: unknown) =>
                toast.error(error instanceof Error ? error.message : String(error))
              )
            }>
            <LifeBuoyIcon className="text-muted-foreground" />
            {t("guide.userGuide")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <HotkeysDialog open={hotkeysOpen} onOpenChange={setHotkeysOpen} />
    </>
  )
}
