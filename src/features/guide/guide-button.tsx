import { AccountMenuItem, HelpMenu } from "@alwith/module-chat/session-list"
import { KeyboardIcon, LifeBuoyIcon } from "lucide-react"
import { type ReactNode, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { ShortcutKey } from "@/components/alwith-ui/shortcut-hint"
import { HotkeysDialog } from "@/features/settings/hotkeys-dialog"

import { openGuideWindow } from "./guide-window"

/** U's help menu: module-chat's HelpMenu with the shortcuts sheet and the user guide. */
export function GuideButton(): ReactNode {
  const { t } = useTranslation()
  const [hotkeysOpen, setHotkeysOpen] = useState(false)
  return (
    <>
      <HelpMenu>
        <AccountMenuItem onClick={() => setHotkeysOpen(true)}>
          <KeyboardIcon />
          {t("shortcuts.title")}
          <ShortcutKey shortcut="CmdOrCtrl+/" className="ml-auto shrink-0" />
        </AccountMenuItem>
        <AccountMenuItem
          onClick={() =>
            void openGuideWindow().catch((error: unknown) =>
              toast.error(error instanceof Error ? error.message : String(error))
            )
          }
        >
          <LifeBuoyIcon />
          {t("guide.userGuide")}
        </AccountMenuItem>
      </HelpMenu>
      <HotkeysDialog open={hotkeysOpen} onOpenChange={setHotkeysOpen} />
    </>
  )
}
