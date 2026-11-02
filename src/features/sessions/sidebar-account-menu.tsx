import {
  AccountLanguageMenu,
  AccountMenu,
  AccountMenuGroup,
  AccountMenuItem,
  AccountMenuSeparator
} from "@alwith/module-chat/session-list"
import { AppWindowIcon, Gamepad2Icon, PawPrintIcon, SettingsIcon, SmartphoneIcon } from "lucide-react"
import { type ReactNode, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { ShortcutKey } from "@/components/alwith-ui/shortcut-hint"
import { logoutPlatform, usePlatformAuth } from "@/features/auth/store"
import { useVibemonControl } from "@/features/vibemon/use-vibemon-control"
import { CreateWorkBuddy } from "@/features/workbuddy/create-workbuddy"
import { LANGUAGES } from "@/lib/i18n"
import { savePreference } from "@/lib/preferences"
import { openGamepadWindow, openSettingsWindow } from "@/lib/window-manager"

const reportError = (error: unknown): void => void toast.error(error instanceof Error ? error.message : String(error))

/** U's account menu: module-chat's AccountMenu with U's items. */
export function SidebarAccountMenu({
  onOpenSettings,
  onCreated
}: {
  onOpenSettings: () => void
  onCreated: (directory: string) => void
}): ReactNode {
  const { t, i18n } = useTranslation()
  const user = usePlatformAuth((state) => state.user)
  const [createOpen, setCreateOpen] = useState(false)
  const vibemon = useVibemonControl()
  if (!user) return null
  return (
    <>
      <CreateWorkBuddy open={createOpen} onOpenChange={setCreateOpen} onCreated={onCreated} />
      <AccountMenu
        user={{ name: user.nickname || user.login_email, email: user.login_email, avatar: user.avatar }}
        onSignOut={logoutPlatform}
      >
        <AccountMenuGroup>
          <AccountMenuItem onClick={() => setCreateOpen(true)}>
            <AppWindowIcon />
            {t("workbuddy.create")}
          </AccountMenuItem>
        </AccountMenuGroup>
        <AccountMenuSeparator />
        <AccountMenuGroup>
          <AccountMenuItem disabled={vibemon.disabled} onClick={() => void vibemon.toggle()}>
            <PawPrintIcon />
            {t(vibemon.enabled ? "pet.hide" : "pet.show")}
          </AccountMenuItem>
          <AccountMenuItem onClick={() => void openSettingsWindow("mobile")}>
            <SmartphoneIcon />
            {t("settings.mobile")}
          </AccountMenuItem>
          <AccountMenuItem onClick={() => void openGamepadWindow().catch(reportError)}>
            <Gamepad2Icon />
            {t("settings.gamepad")}
          </AccountMenuItem>
        </AccountMenuGroup>
        <AccountMenuSeparator />
        <AccountMenuGroup>
          <AccountLanguageMenu
            languages={LANGUAGES}
            value={i18n.language}
            onChange={async (language) => {
              await i18n.changeLanguage(language)
              await savePreference("language", language)
            }}
          />
          <AccountMenuItem onClick={onOpenSettings}>
            <SettingsIcon />
            {t("sidebar.settings")}
            <ShortcutKey shortcut="CmdOrCtrl+," className="ml-auto shrink-0" />
          </AccountMenuItem>
        </AccountMenuGroup>
      </AccountMenu>
    </>
  )
}
