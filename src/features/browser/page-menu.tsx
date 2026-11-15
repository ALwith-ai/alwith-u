import { useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"

import { resolveAddress } from "./address"

/** An entry the browser offers in a page's context menu. */
export interface PageMenuItem {
  command: number
  label: string
  kind: "command" | "check" | "radio" | "separator" | "submenu"
  enabled: boolean
  checked: boolean
  items: PageMenuItem[]
}
/** The context menu the user asked for in a page, as its browser reports it. */
export interface PageMenu {
  id: number
  /** In the window, from its top left corner, in the browser's points: the page is composited into the window. */
  x: number
  y: number
  linkUrl: string
  imageUrl: string
  selectionText: string
  editable: boolean
  items: PageMenuItem[]
}
/** What choosing an entry does: a command of the browser's, or something the application does itself. */
export type MenuAction =
  | { command: number }
  | { open: string }
  | { copy: string }
  | { save: string }
  | { reload: true }
  | { source: true }
  | { inspect: true }
export type MenuEntry =
  | { kind: "separator" }
  | { kind: "item"; label: string; enabled: boolean; checked?: boolean; action: MenuAction }
  | { kind: "submenu"; label: string; enabled: boolean; items: MenuEntry[] }

const back = 100
const forward = 101
/** How an entry is worded: a key of the `pageMenu` catalog and what it is given. */
export type Words = (key: string, values?: Record<string, string>) => string
/** The browser's own entries, worded by the application. An entry of an extension keeps its title. */
const labels: Record<number, string> = {
  [back]: "back",
  [forward]: "forward",
  110: "undo",
  111: "redo",
  112: "cut",
  113: "copy",
  114: "paste",
  115: "pasteMatchStyle",
  116: "delete",
  117: "selectAll",
  131: "print",
  206: "addToDictionary"
}
const viewSource = 132
/** Entries left out: reload variants and stop are on the toolbar, and find has its bar. */
const withheld = new Set([102, 103, 104, 130])
const shown = (text: string) => (text.length > 24 ? `${text.slice(0, 24)}…` : text)

function fromBrowser(items: PageMenuItem[], words: Words): MenuEntry[] {
  return items.flatMap((item): MenuEntry[] => {
    if (item.kind === "separator") return [{ kind: "separator" }]
    if (withheld.has(item.command)) return []
    // The source opens in a tab of the user's; the browser would look for a window of its own.
    if (item.command === viewSource)
      return [{ kind: "item", label: words("viewSource"), enabled: item.enabled, action: { source: true } }]
    const key = labels[item.command]
    const label = key ? words(key) : item.label
    if (item.kind === "submenu")
      return [{ kind: "submenu", label, enabled: item.enabled, items: tidy(fromBrowser(item.items, words)) }]
    return [
      {
        kind: "item",
        label,
        enabled: item.enabled,
        ...(item.kind !== "command" && { checked: item.checked }),
        action: { command: item.command }
      }
    ]
  })
}
/** No separator opens or ends a menu, and none follows another. */
function tidy(entries: MenuEntry[]): MenuEntry[] {
  const kept = entries.filter(
    (entry, index) => entry.kind !== "separator" || (index > 0 && entries[index - 1]!.kind !== "separator")
  )
  while (kept.at(-1)?.kind === "separator") kept.pop()
  return kept
}

/** The menu as the user sees it: what the application adds for a link, an image or a selection, then the browser's. */
export function menuEntries(menu: PageMenu, words: Words): MenuEntry[] {
  const item = (label: string, action: MenuAction): MenuEntry => ({ kind: "item", label, enabled: true, action })
  // Only what the browser can fetch again is offered for saving.
  const saved = (key: string, url: string) => (/^https?:\/\//i.test(url) ? [item(words(key), { save: url })] : [])
  const own: MenuEntry[] = []
  if (menu.linkUrl)
    own.push(
      item(words("openLink"), { open: menu.linkUrl }),
      item(words("copyLink"), { copy: menu.linkUrl }),
      ...saved("saveLink", menu.linkUrl),
      {
        kind: "separator"
      }
    )
  if (menu.imageUrl)
    own.push(
      item(words("openImage"), { open: menu.imageUrl }),
      item(words("copyImage"), { copy: menu.imageUrl }),
      ...saved("saveImage", menu.imageUrl),
      {
        kind: "separator"
      }
    )
  const selection = menu.selectionText.trim()
  if (selection && !menu.editable)
    own.push(item(words("search", { text: shown(selection) }), { open: resolveAddress(selection) }), {
      kind: "separator"
    })
  const browser = fromBrowser(menu.items, words)
  // Reloading belongs with going back and forward, where the page itself was asked about.
  const history = browser.findIndex(
    (entry) => entry.kind === "item" && "command" in entry.action && entry.action.command === forward
  )
  if (history !== -1) browser.splice(history + 1, 0, item(words("reload"), { reload: true }))
  const entries = tidy([...own, ...browser])
  // Last, as every browser has it: the element under the pointer in the developer tools.
  return entries.length === 0 ? [] : [...entries, { kind: "separator" }, item(words("inspect"), { inspect: true })]
}

/** What an entry does, in words that do not change with the language: what a script asks for it by. */
const nameOf = (action: MenuAction) =>
  "command" in action
    ? `command:${action.command}`
    : "open" in action
      ? `open:${action.open}`
      : "copy" in action
        ? `copy:${action.copy}`
        : "save" in action
          ? `save:${action.save}`
          : "reload" in action
            ? "reload"
            : "source" in action
              ? "source"
              : "inspect"

function Entries({ entries, onChoose }: { entries: MenuEntry[]; onChoose: (action: MenuAction) => void }) {
  return entries.map((entry, index) => {
    const key = `${index}:${entry.kind === "separator" ? "" : entry.label}`
    if (entry.kind === "separator") return <DropdownMenuSeparator key={key} />
    if (entry.kind === "submenu")
      return (
        <DropdownMenuSub key={key}>
          <DropdownMenuSubTrigger disabled={!entry.enabled}>{entry.label}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <Entries entries={entry.items} onChoose={onChoose} />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      )
    if (entry.checked !== undefined)
      return (
        <DropdownMenuCheckboxItem
          key={key}
          checked={entry.checked}
          disabled={!entry.enabled}
          data-entry={nameOf(entry.action)}
          onClick={() => onChoose(entry.action)}
        >
          {entry.label}
        </DropdownMenuCheckboxItem>
      )
    return (
      <DropdownMenuItem
        key={key}
        disabled={!entry.enabled}
        data-entry={nameOf(entry.action)}
        onClick={() => onChoose(entry.action)}
      >
        {entry.label}
      </DropdownMenuItem>
    )
  })
}

/**
 * A page's context menu, drawn by the application where the user asked for it. `scale` is how many of the
 * browser's points make one of the interface's: its zoom.
 */
export function PageContextMenu({
  menu,
  scale,
  onChoose,
  onDismiss
}: {
  menu: PageMenu
  scale: number
  onChoose: (action: MenuAction) => void
  onDismiss: () => void
}) {
  // Choosing closes the menu too; only a menu closed without a choice is dismissed.
  const chosen = useRef(false)
  const { t } = useTranslation()
  const entries = menuEntries(menu, (key, values) => t(`pageMenu.${key}`, values ?? {}))
  // Nothing to offer here: the browser is told so, and waits no longer.
  const empty = entries.length === 0
  useEffect(() => {
    if (empty) onDismiss()
  }, [empty, onDismiss])
  if (empty) return null
  return (
    <>
      {/* A press on the page would go to the page and leave the menu open; this takes it instead. */}
      <div className="fixed inset-0 z-40" onPointerDown={onDismiss} onContextMenu={(event) => event.preventDefault()} />
      <DropdownMenu
        open
        onOpenChange={(open) => {
          if (!open && !chosen.current) onDismiss()
        }}
      >
        <DropdownMenuTrigger
          render={
            <span
              aria-hidden
              className="pointer-events-none fixed size-0"
              style={{ left: menu.x / scale, top: menu.y / scale }}
            />
          }
        />
        <DropdownMenuContent
          data-page-menu
          aria-label={t("pageMenu.label")}
          align="start"
          sideOffset={0}
          className="w-auto min-w-48"
        >
          <Entries
            entries={entries}
            onChoose={(action) => {
              chosen.current = true
              onChoose(action)
            }}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
