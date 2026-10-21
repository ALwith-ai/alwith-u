import { KeyboardIcon, MessageSquareIcon, PlusIcon, PuzzleIcon, SettingsIcon, SunMoonIcon } from "lucide-react"
import { type ReactNode, useMemo, useRef, useState } from "react"
import { flushSync } from "react-dom"
import { useTranslation } from "react-i18next"

import type { ThreadSummary } from "@/agent/client"
import { hasPluginStore } from "@/agent/codex-extensions"
import { useTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
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
import { reportExtensionError, useExtensions } from "@/features/extensions/runtime"
import { useApp } from "@/lib/client"
import { basename } from "@/lib/path"
import { displayShortcut } from "@/lib/shortcut-formatter"
import { openSettingsWindow } from "@/lib/window-manager"

import { type PaletteSearchGroup, searchPalette } from "./search"

const PAGE_SIZE = 20

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onNewChat: () => void
  onOpenSettings: () => void
  onOpenPlugins: () => void
  onOpenHotkeys: () => void
  onOpenExtension: (id: string) => void
  onSelect: (thread: ThreadSummary) => void
}

type Entry = {
  id: string
  search: string
  label: string
  icon: ReactNode
  detail?: string
  shortcut?: string
  run: () => void
}

export function CommandPalette(props: Props) {
  const { t } = useTranslation()
  return (
    <CommandDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t("palette.actions")}
      description={t("palette.placeholder")}
    >
      {props.open && <PaletteContent {...props} />}
    </CommandDialog>
  )
}

function PaletteContent({
  onOpenChange,
  onNewChat,
  onOpenSettings,
  onOpenPlugins,
  onOpenHotkeys,
  onOpenExtension,
  onSelect
}: Props) {
  const { t } = useTranslation()
  const { host: extensions } = useExtensions()
  const { resolvedTheme, setTheme } = useTheme()
  const threads = useApp((state) => state.threads)
  const pluginsAvailable = useApp((state) => hasPluginStore(state.agent))
  const [query, setQuery] = useState("")
  const [page, setPage] = useState({ query: "", limit: PAGE_SIZE })
  const list = useRef<HTMLDivElement>(null)
  const groups = useMemo<PaletteSearchGroup<Entry>[]>(() => {
    const action = (id: string, label: string, icon: ReactNode, run: () => void, shortcut?: string): Entry => ({
      id,
      label,
      search: `${label} ${shortcut ?? ""}`,
      icon,
      run,
      shortcut
    })
    return [
      {
        id: "actions",
        heading: t("palette.actions"),
        entries: [
          action("action:new", t("palette.newChat"), <PlusIcon />, onNewChat, displayShortcut("CmdOrCtrl+N")),
          action("action:theme", t("palette.toggleTheme"), <SunMoonIcon />, () =>
            setTheme(resolvedTheme === "dark" ? "light" : "dark")
          ),
          action(
            "action:settings",
            t("palette.settings"),
            <SettingsIcon />,
            onOpenSettings,
            displayShortcut("CmdOrCtrl+,")
          ),
          action(
            "action:hotkeys",
            t("palette.hotkeys"),
            <KeyboardIcon />,
            onOpenHotkeys,
            displayShortcut("CmdOrCtrl+/")
          ),
          ...(pluginsAvailable ? [action("action:plugins", t("palette.plugins"), <PuzzleIcon />, onOpenPlugins)] : [])
        ]
      },
      {
        id: "extensions",
        heading: t("settings.extensions"),
        entries: [
          action("action:extensions", t("extensions.manage"), <SettingsIcon />, () => {
            void openSettingsWindow("extensions").catch(reportExtensionError)
          }),
          ...extensions.commands.map((command) => ({
            id: `extension-command:${command.id}`,
            search: `extension-command ${command.id} ${command.title}`,
            label: command.title,
            icon: <PuzzleIcon />,
            run: () => {
              void Promise.resolve()
                .then(() => command.run())
                .catch(reportExtensionError)
            }
          })),
          ...extensions.views
            .filter((view) => view.kind === "surfaces")
            .map((view) => ({
              id: `extension-surface:${view.id}`,
              search: `extension-surface ${view.id} ${view.title}`,
              label: view.title,
              icon: <PuzzleIcon />,
              run: () => onOpenExtension(view.id)
            }))
        ]
      },
      {
        id: "chats",
        heading: t("palette.chats"),
        entries: threads.map((thread) => ({
          id: `thread:${thread.sessionId}`,
          search: `${thread.title ?? ""} ${thread.cwd} ${thread.sessionId}`,
          label: thread.title ?? t("sidebar.untitled"),
          detail: basename(thread.cwd),
          icon: <MessageSquareIcon />,
          run: () => onSelect(thread)
        }))
      }
    ]
  }, [
    extensions.commands,
    extensions.views,
    onNewChat,
    onOpenExtension,
    onOpenHotkeys,
    onOpenPlugins,
    onOpenSettings,
    onSelect,
    pluginsAvailable,
    resolvedTheme,
    setTheme,
    t,
    threads
  ])
  // Match the complete catalog in data; cmdk only registers the displayed page.
  const matches = useMemo(() => searchPalette(groups, query), [groups, query])
  const limit = page.query === query ? page.limit : PAGE_SIZE
  const count = matches.reduce((total, group) => total + group.entries.length, 0)
  const entries = matches.flatMap((group) => group.entries)
  const visible = entries.slice(0, limit)
  const more = count > limit
  const showMore = () => {
    setPage({ query, limit: limit + PAGE_SIZE })
  }
  let remaining = limit
  return (
    <Command
      shouldFilter={false}
      onKeyDownCapture={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229 || !more) return
        const next = event.key === "ArrowDown" || (event.ctrlKey && (event.key === "n" || event.key === "j"))
        if (!next) return
        const selected = event.currentTarget
          .querySelector('[role="option"][aria-selected="true"]')
          ?.getAttribute("data-value")
        if (selected !== visible.at(-1)?.id) return
        // Mount the next page before cmdk handles this same ArrowDown event.
        // Its own selection then retains scrolling and aria-activedescendant.
        flushSync(showMore)
      }}
    >
      <CommandInput
        placeholder={t("palette.placeholder")}
        value={query}
        onValueChange={(value) => {
          setQuery(value)
          if (list.current) list.current.scrollTop = 0
        }}
      />
      <CommandList
        ref={list}
        onScroll={(event) => {
          const root = event.currentTarget
          if (more && root.scrollHeight - root.clientHeight - root.scrollTop < 64) showMore()
        }}
      >
        <CommandEmpty>{t("sidebar.noResults")}</CommandEmpty>
        {matches.map((group) => {
          const current = group.entries.slice(0, remaining)
          remaining -= current.length
          if (current.length === 0) return null
          return (
            <CommandGroup key={group.id} heading={group.heading}>
              {current.map((entry) => (
                <CommandItem
                  key={entry.id}
                  value={entry.id}
                  className="[&>svg:last-child]:hidden"
                  onSelect={() => {
                    onOpenChange(false)
                    entry.run()
                  }}
                >
                  {entry.icon}
                  <span className="min-w-0 truncate">{entry.label}</span>
                  {entry.detail !== undefined && (
                    <span className="ms-auto max-w-1/3 truncate text-xs text-muted-foreground">{entry.detail}</span>
                  )}
                  {entry.shortcut !== undefined && <CommandShortcut>{entry.shortcut}</CommandShortcut>}
                </CommandItem>
              ))}
            </CommandGroup>
          )
        })}
        {more && (
          <Button
            variant="ghost"
            className="h-8 w-full justify-start px-2 text-xs text-muted-foreground"
            onKeyDown={(event) => {
              if (event.key === "Enter") event.stopPropagation()
            }}
            onClick={showMore}
          >
            {t("palette.moreResults", { count: count - limit })}
          </Button>
        )}
      </CommandList>
    </Command>
  )
}
