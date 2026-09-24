import { KeyboardIcon, MessageSquareIcon, PlusIcon, PuzzleIcon, SettingsIcon, SunMoonIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { useTheme } from "@/components/theme-provider"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut
} from "@/components/ui/command"
import type { ThreadSummary } from "@/agent/client"
import { hasPluginStore } from "@/agent/codex-extensions"
import { useApp } from "@/lib/client"
import { basename } from "@/lib/path"
import { displayShortcut } from "@/lib/shortcut-formatter"

export function CommandPalette({
  open,
  onOpenChange,
  onNewChat,
  onOpenSettings,
  onOpenPlugins,
  onOpenHotkeys,
  onSelect
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onNewChat: () => void
  onOpenSettings: () => void
  onOpenPlugins: () => void
  onOpenHotkeys: () => void
  onSelect: (thread: ThreadSummary) => void
}) {
  const { t } = useTranslation()
  const { resolvedTheme, setTheme } = useTheme()
  const threads = useApp(state => state.threads)
  const pluginsAvailable = useApp(state => hasPluginStore(state.agent))
  const run = (action: () => void) => {
    onOpenChange(false)
    action()
  }
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("palette.actions")}
      description={t("palette.placeholder")}>
      <Command>
        <CommandInput placeholder={t("palette.placeholder")} />
        <CommandList>
          <CommandEmpty>{t("sidebar.noResults")}</CommandEmpty>
          <CommandGroup heading={t("palette.actions")}>
            <CommandItem onSelect={() => run(onNewChat)}>
              <PlusIcon />
              {t("palette.newChat")}
              <CommandShortcut>{displayShortcut("CmdOrCtrl+N")}</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => run(() => setTheme(resolvedTheme === "dark" ? "light" : "dark"))}>
              <SunMoonIcon />
              {t("palette.toggleTheme")}
            </CommandItem>
            <CommandItem onSelect={() => run(onOpenSettings)}>
              <SettingsIcon />
              {t("palette.settings")}
              <CommandShortcut>{displayShortcut("CmdOrCtrl+,")}</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => run(onOpenHotkeys)}>
              <KeyboardIcon />
              {t("palette.hotkeys")}
              <CommandShortcut>{displayShortcut("CmdOrCtrl+/")}</CommandShortcut>
            </CommandItem>
            {pluginsAvailable && (
              <CommandItem onSelect={() => run(onOpenPlugins)}>
                <PuzzleIcon />
                {t("palette.plugins")}
              </CommandItem>
            )}
          </CommandGroup>
          {threads.length > 0 && (
            <CommandGroup heading={t("palette.chats")}>
              {threads.map(thread => (
                <CommandItem
                  key={thread.sessionId}
                  value={`${thread.title ?? ""} ${thread.cwd} ${thread.sessionId}`}
                  onSelect={() => run(() => onSelect(thread))}>
                  <MessageSquareIcon />
                  <span className="truncate">{thread.title ?? t("sidebar.untitled")}</span>
                  <span className="text-muted-foreground ms-auto truncate text-xs">{basename(thread.cwd)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
