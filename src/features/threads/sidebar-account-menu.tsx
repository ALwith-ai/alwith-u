import { Gamepad2Icon, GlobeIcon, LogOutIcon, PawPrintIcon, SettingsIcon } from "lucide-react"
import { type ReactNode, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { ShortcutKey } from "@/components/alwith-ui/shortcut-hint"
import { useSidebarOverlay } from "@/components/alwith-ui/sidebar-overlay-context"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { logoutPlatform, usePlatformAuth } from "@/features/auth/store"
import { useVibemonControl } from "@/features/vibemon/use-vibemon-control"
import { LANGUAGES } from "@/lib/i18n"
import { savePreference } from "@/lib/preferences"
import { openGamepadWindow } from "@/lib/window-manager"

export function SidebarAccountMenu({ onOpenSettings }: { onOpenSettings: () => void }): ReactNode {
  const { t, i18n } = useTranslation()
  const user = usePlatformAuth((state) => state.user)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const vibemon = useVibemonControl()
  useSidebarOverlay(open)
  if (!user) return null

  const displayName = user.nickname || user.login_email
  const avatar = (
    <Avatar className="size-5 after:border-0">
      <AvatarImage src={user.avatar} alt="" />
      <AvatarFallback className="bg-primary text-xs text-primary-foreground">
        {[...displayName].slice(0, 2).join("").toLocaleUpperCase()}
      </AvatarFallback>
    </Avatar>
  )

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            disabled={busy}
            className="h-8 w-full justify-start gap-2 rounded-[10px] px-2 font-normal text-muted-foreground [corner-shape:superellipse(1.5)] hover:bg-foreground/5 data-popup-open:bg-foreground/5"
          />
        }
      >
        {avatar}
        <span className="min-w-0 truncate">{displayName}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" sideOffset={8} className="w-[calc(var(--anchor-width)+36px)]">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center gap-2 px-2 py-2 text-sm font-medium text-popover-foreground">
            {avatar}
            <span className="min-w-0 flex-1">
              <span className="block truncate">{displayName}</span>
              <span className="mt-0.5 block truncate text-xs font-normal text-muted-foreground">
                {user.login_email}
              </span>
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
        </DropdownMenuGroup>
        <DropdownMenuGroup>
          <DropdownMenuItem className="h-8 py-0" onClick={onOpenSettings}>
            <SettingsIcon className="text-muted-foreground" />
            {t("sidebar.settings")}
            <ShortcutKey shortcut="CmdOrCtrl+," className="ml-auto shrink-0" />
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="h-8 py-0">
              <GlobeIcon className="text-muted-foreground" />
              {t("settings.language")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={i18n.language}
                onValueChange={(value) => {
                  const language = value as string
                  void (async () => {
                    await i18n.changeLanguage(language)
                    await savePreference("language", language)
                  })().catch((error: unknown) => toast.error(error instanceof Error ? error.message : String(error)))
                }}
              >
                {LANGUAGES.map((language) => (
                  <DropdownMenuRadioItem key={language.code} value={language.code}>
                    {language.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            disabled={busy || vibemon.disabled}
            className="h-8 py-0"
            onClick={() => void vibemon.toggle()}
          >
            <PawPrintIcon className="text-muted-foreground" />
            {t(vibemon.enabled ? "pet.disable" : "pet.enable")}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="h-8 py-0"
            onClick={() =>
              void openGamepadWindow().catch((error: unknown) =>
                toast.error(error instanceof Error ? error.message : String(error))
              )
            }
          >
            <Gamepad2Icon className="text-muted-foreground" />
            {t("settings.gamepad")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            disabled={busy}
            className="h-8 py-0"
            onClick={() => {
              setBusy(true)
              void logoutPlatform()
                .catch(() => toast.error(t("platformAuth.failed")))
                .finally(() => setBusy(false))
            }}
          >
            <LogOutIcon className="text-muted-foreground" />
            {t("sidebar.signOut")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
