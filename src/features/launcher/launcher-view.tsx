import { AppWindowIcon, FolderIcon, MessageSquareIcon, PlusIcon, TerminalIcon } from "lucide-react"
import { type ReactNode, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"

import { searchQuery } from "./lib/match"
import { browse, type Entry, type EntryKind, type Indexed, rank } from "./lib/order"
import type { Usage } from "./lib/usage"

/** Rows shown for one query; a launcher answers with the top of the order, not with a catalog. */
const LIMIT = 50
const SEND = "launcher:send"

interface Props {
  catalog: Indexed[]
  /** An entry's own icon as an image URL, or `null` for one that shows its kind's glyph. */
  icon: (entry: Entry) => Promise<string | null>
  usage: Usage
  /** The query is the folded text the entry was picked for; empty when it was picked from the list. */
  onOpen: (entry: Entry, query: string) => void
  /** The text as typed, for a new chat. */
  onSend: (text: string) => void
  /** Tab moves to the clipboard history; absent where there is none to move to. */
  onClipboard?: () => void
  onDismiss: () => void
}

const GLYPHS: Record<EntryKind, ReactNode> = {
  application: <AppWindowIcon />,
  command: <TerminalIcon />,
  session: <MessageSquareIcon />,
  project: <FolderIcon />
}

const KIND_LABELS = {
  application: "launcher.application",
  command: "launcher.command",
  session: "launcher.chat",
  project: "launcher.project"
} as const satisfies Record<EntryKind, string>

/** A row's icon. The box has its size from the first frame; an icon arriving later only fills it. */
function EntryIcon({ entry, load }: { entry: Entry; load: Props["icon"] }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let current = true
    void load(entry).then((loaded) => {
      if (current) setUrl(loaded)
    })
    return () => {
      current = false
    }
  }, [entry, load])
  return (
    <span className="flex size-4 shrink-0 items-center justify-center [&>svg]:size-4">
      {url === null ? GLYPHS[entry.kind] : <img src={url} alt="" className="size-4" />}
    </span>
  )
}

export function LauncherView({ catalog, icon, usage, onOpen, onSend, onClipboard, onDismiss }: Props) {
  const { t } = useTranslation()
  const [typed, setTyped] = useState("")
  const query = searchQuery(typed)
  const results = useMemo(() => {
    // One clock read per pass, so two entries are never compared at different times.
    const now = Date.now()
    return (query.length === 0 ? browse(catalog, usage, now) : rank(catalog, query, usage, now)).slice(0, LIMIT)
  }, [catalog, query, usage])
  return (
    <Command
      className="h-dvh"
      shouldFilter={false}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return
        if (event.key === "Escape") onDismiss()
        if (event.key === "Tab" && onClipboard !== undefined) {
          event.preventDefault()
          onClipboard()
        }
      }}
    >
      <CommandInput autoFocus placeholder={t("launcher.placeholder")} value={typed} onValueChange={setTyped} />
      <CommandList className="max-h-none flex-1">
        {results.length > 0 && (
          <CommandGroup heading={t("launcher.results")}>
            {results.map((entry) => (
              <CommandItem
                key={entry.id}
                value={entry.id}
                className="[&>svg:last-child]:hidden"
                onSelect={() => onOpen(entry, query)}
              >
                <EntryIcon entry={entry} load={icon} />
                <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                <span className="ms-auto max-w-1/3 truncate text-xs text-muted-foreground">
                  {entry.subtitle.length === 0 ? t(KIND_LABELS[entry.kind]) : entry.subtitle}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {query.length > 0 && (
          <CommandGroup heading={t("launcher.sendTo", { query: typed.trim() })}>
            <CommandItem value={SEND} className="[&>svg:last-child]:hidden" onSelect={() => onSend(typed.trim())}>
              <PlusIcon />
              <span className="flex-1">{t("launcher.newChat")}</span>
            </CommandItem>
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  )
}
