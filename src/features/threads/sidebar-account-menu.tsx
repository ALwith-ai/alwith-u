import { LogOutIcon, PawPrintIcon, SettingsIcon } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { useSidebarOverlay } from "@/components/alwith-ui/sidebar-overlay-context"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { logoutPlatform, usePlatformAuth } from "@/features/auth/store"
import { useVibemonControl } from "@/features/vibemon/use-vibemon-control"

export function SidebarAccountMenu({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { t } = useTranslation()
  const user = usePlatformAuth(state => state.user)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const vibemon = useVibemonControl()
  useSidebarOverlay(open)
  if (!user) return null

  const displayName = user.nickname || user.login_email
  const avatar = (
    <Avatar className="size-7 after:border-0">
      <AvatarImage src={user.avatar} alt="" />
      <AvatarFallback className="bg-primary text-primary-foreground text-xs">
        {Array.from(displayName).slice(0, 2).join("").toLocaleUpperCase()}
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
            className="text-muted-foreground hover:bg-foreground/5 data-popup-open:bg-foreground/5 h-10 w-full justify-start gap-2.5 rounded-lg px-2 font-normal"
          />
        }>
        {avatar}
        <span className="min-w-0 truncate">{displayName}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" sideOffset={8} className="rounded-2xl p-2 shadow-lg ring-0">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-popover-foreground flex h-12 items-center gap-3 px-2 text-sm font-medium">
            {avatar}
            <span className="min-w-0 truncate">{displayName}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator className="mx-0 my-2" />
          <DropdownMenuItem
            disabled={busy || vibemon.disabled}
            className="h-10 gap-3 rounded-lg px-2 [&_svg]:size-5"
            onClick={() => void vibemon.toggle()}>
            <PawPrintIcon className="text-muted-foreground" />
            {t(vibemon.enabled ? "pet.disable" : "pet.enable")}
          </DropdownMenuItem>
          <DropdownMenuItem className="h-10 gap-3 rounded-lg px-2 [&_svg]:size-5" onClick={onOpenSettings}>
            <SettingsIcon className="text-muted-foreground" />
            {t("sidebar.settings")}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={busy}
            className="h-10 gap-3 rounded-lg px-2 [&_svg]:size-5"
            onClick={() => {
              setBusy(true)
              void logoutPlatform()
                .catch(() => toast.error(t("platformAuth.failed")))
                .finally(() => setBusy(false))
            }}>
            <LogOutIcon className="text-muted-foreground" />
            {t("sidebar.signOut")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
