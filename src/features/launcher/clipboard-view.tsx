import { ClipboardIcon, FileIcon, ImageIcon, PinIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import type { Item_Serialize as ClipboardItem } from "@/bindings"
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { basename } from "@/lib/path"

const LIMIT = 100

/** The clipboard history as the view needs it; the window binds it to the native commands. */
export interface ClipboardHost {
  list: (query: string, limit: number) => Promise<ClipboardItem[]>
  thumbnail: (id: number) => Promise<string>
  copy: (id: number) => Promise<unknown>
  pin: (id: number, pinned: boolean) => Promise<unknown>
  remove: (id: number) => Promise<unknown>
  /** Calls back after the history changed and resolves to what stops it. */
  watch: (changed: () => void) => Promise<() => void>
}

interface Props {
  host: ClipboardHost
  /** An entry is back on the system clipboard. */
  onCopied: () => void
  /** Tab returns to the launcher's own list. */
  onLeave: () => void
  onDismiss: () => void
}

function label(item: ClipboardItem, image: string): string {
  if (item.kind === "image") return image
  if (item.kind === "files") return item.text.split("\n").map(basename).join(", ")
  // The first line that says something stands for the entry.
  return (
    item.text
      .split("\n")
      .find((line) => line.trim().length > 0)
      ?.trim() ?? ""
  )
}

export function ClipboardView({ host, onCopied, onLeave, onDismiss }: Props) {
  const { t } = useTranslation()
  const [query, setQuery] = useState("")
  const [revision, setRevision] = useState(0)
  const [items, setItems] = useState<ClipboardItem[]>([])
  const [thumbnails, setThumbnails] = useState<Record<number, string>>({})

  useEffect(() => {
    const watching = host.watch(() => setRevision((count) => count + 1))
    return () => void watching.then((stop) => stop())
  }, [host])

  useEffect(() => {
    let current = true
    // A slower answer to an older query must not replace a newer one.
    void host.list(query.trim(), LIMIT).then((listed) => {
      if (current) setItems(listed)
    })
    return () => {
      current = false
    }
  }, [host, query, revision])

  useEffect(() => {
    let current = true
    for (const item of items) {
      if (item.kind !== "image" || thumbnails[item.id] !== undefined) continue
      void host.thumbnail(item.id).then((url) => {
        if (current) setThumbnails((known) => ({ ...known, [item.id]: url }))
      })
    }
    return () => {
      current = false
    }
  }, [host, items, thumbnails])

  const pinned = items.filter((item) => item.pinned)
  const recent = items.filter((item) => !item.pinned)
  const rows = (group: ClipboardItem[]) =>
    group.map((item) => (
      <CommandItem
        key={item.id}
        value={String(item.id)}
        className="[&>svg:last-child]:hidden"
        onSelect={() => void host.copy(item.id).then(onCopied)}
      >
        {item.kind === "image" ? (
          thumbnails[item.id] === undefined ? (
            <ImageIcon />
          ) : (
            <img src={thumbnails[item.id]} alt="" className="size-8 shrink-0 rounded-sm object-cover" />
          )
        ) : item.kind === "files" ? (
          <FileIcon />
        ) : (
          <ClipboardIcon />
        )}
        <span className="min-w-0 flex-1 truncate">{label(item, t("launcher.image"))}</span>
        {item.pinned && <PinIcon className="ms-auto text-muted-foreground" />}
      </CommandItem>
    ))

  return (
    <Command
      className="h-dvh"
      shouldFilter={false}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return
        if (event.key === "Escape") return onDismiss()
        if (event.key === "Tab") {
          event.preventDefault()
          return onLeave()
        }
        if (!event.metaKey && !event.ctrlKey) return
        const selected = event.currentTarget
          .querySelector('[role="option"][aria-selected="true"]')
          ?.getAttribute("data-value")
        const item = items.find((listed) => String(listed.id) === selected)
        if (item === undefined) return
        if (event.key === "p") {
          event.preventDefault()
          void host.pin(item.id, !item.pinned)
        } else if (event.key === "Backspace") {
          event.preventDefault()
          void host.remove(item.id)
        }
      }}
    >
      <CommandInput autoFocus placeholder={t("launcher.clipboardPlaceholder")} value={query} onValueChange={setQuery} />
      <CommandList className="max-h-none flex-1">
        {pinned.length > 0 && <CommandGroup heading={t("launcher.pinned")}>{rows(pinned)}</CommandGroup>}
        {recent.length > 0 && <CommandGroup heading={t("launcher.clipboard")}>{rows(recent)}</CommandGroup>}
      </CommandList>
    </Command>
  )
}

/** What Tab shows while the history is off: what turning it on records, and the one way to do so. */
export function ClipboardConsent({
  onEnable,
  onLeave,
  onDismiss
}: Omit<Props, "host" | "onCopied"> & { onEnable: () => void }) {
  const { t } = useTranslation()
  return (
    <Command
      className="h-dvh"
      shouldFilter={false}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return
        if (event.key === "Escape") onDismiss()
        if (event.key === "Tab") {
          event.preventDefault()
          onLeave()
        }
      }}
    >
      <CommandInput autoFocus readOnly placeholder={t("launcher.clipboardOff")} value="" />
      <CommandList className="max-h-none flex-1">
        <CommandGroup heading={t("launcher.clipboardOffDesc")}>
          <CommandItem value="enable" className="[&>svg:last-child]:hidden" onSelect={onEnable}>
            <ClipboardIcon />
            <span className="flex-1">{t("launcher.turnOnClipboard")}</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  )
}
