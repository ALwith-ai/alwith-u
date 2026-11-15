import { type GroupColor, groupColors } from "./tab-groups"

/** Ordinary tabs survive an application restart. AI-bound tabs belong to their conversation and do not. */
interface SavedTab {
  url: string
  title: string
  pinned?: boolean
  history?: TabHistory
  /** Which of the saved groups the tab is in, by its place among them. */
  group?: number
}
/** A group of tabs as it is kept: its tabs name it by its place here. */
export interface SavedGroup {
  title: string
  color: GroupColor
  collapsed?: boolean
}
/** A tab's session history: the pages behind and ahead of the one it shows. */
export interface TabHistory {
  /** `state` is what the page was left in, scroll position and form contents, as the browser encodes it. */
  entries: { url: string; title: string; state?: string }[]
  shown: number
}
/** A history a tab can resume: websites only, showing the tab's own address. */
export const resumable = (history: unknown, url: string): history is TabHistory => {
  if (typeof history !== "object" || history === null) return false
  const { entries, shown } = history as Record<string, unknown>
  return (
    Array.isArray(entries) &&
    typeof shown === "number" &&
    entries.every(
      (entry): entry is TabHistory["entries"][number] =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as { url: unknown }).url === "string" &&
        typeof (entry as { title: unknown }).title === "string" &&
        ["string", "undefined"].includes(typeof (entry as { state: unknown }).state) &&
        restorable((entry as { url: string }).url)
    ) &&
    entries[shown]?.url === url
  )
}
export interface SavedTabs {
  tabs: SavedTab[]
  selected: number
  groups?: SavedGroup[]
}

const key = "alwith.browser.tabs.v1"
const limit = 50
function restorable(url: string) {
  return /^https?:\/\//i.test(url)
}

export function loadTabs(storage: Pick<Storage, "getItem"> = localStorage): SavedTabs | undefined {
  const raw = storage.getItem(key)
  if (raw === null) return undefined
  const value: unknown = JSON.parse(raw)
  if (typeof value !== "object" || value === null) throw new Error("Invalid saved browser tabs")
  const { tabs, selected, groups = [] } = value as Record<string, unknown>
  if (
    !Array.isArray(groups) ||
    !groups.every(
      (group): group is SavedGroup =>
        typeof group === "object" &&
        group !== null &&
        typeof (group as SavedGroup).title === "string" &&
        groupColors.includes((group as SavedGroup).color) &&
        ["boolean", "undefined"].includes(typeof (group as SavedGroup).collapsed)
    ) ||
    !Array.isArray(tabs) ||
    typeof selected !== "number" ||
    !tabs.every(
      (tab): tab is SavedTab =>
        typeof tab === "object" &&
        tab !== null &&
        typeof (tab as SavedTab).url === "string" &&
        typeof (tab as SavedTab).title === "string" &&
        ["boolean", "undefined"].includes(typeof (tab as SavedTab).pinned) &&
        restorable((tab as SavedTab).url) &&
        ((tab as SavedTab).group === undefined || groups[(tab as SavedTab).group!] !== undefined) &&
        ((tab as SavedTab).history === undefined || resumable((tab as SavedTab).history, (tab as SavedTab).url))
    )
  )
    throw new Error("Invalid saved browser tabs")
  if (tabs.length === 0) return undefined
  return {
    tabs,
    selected: Math.min(Math.max(0, Math.trunc(selected)), tabs.length - 1),
    ...(groups.length > 0 && { groups })
  }
}

export function saveTabs(
  tabs: readonly {
    url?: string
    title: string
    bound: boolean
    pinned?: boolean
    history?: TabHistory
    group?: string
  }[],
  selected: number,
  storage: Pick<Storage, "setItem" | "removeItem"> = localStorage,
  groups: readonly (SavedGroup & { id: string })[] = []
) {
  const kept = tabs
    .flatMap((tab, index) =>
      !tab.bound && tab.url !== undefined && restorable(tab.url)
        ? [{ url: tab.url, title: tab.title, pinned: tab.pinned, history: tab.history, group: tab.group, index }]
        : []
    )
    .slice(-limit)
  if (kept.length === 0) {
    storage.removeItem(key)
    return
  }
  const position = kept.findIndex(({ index }) => index === selected)
  // Only the groups a kept tab is in are kept, named by their place among those.
  const keptGroups = groups.filter((group) => kept.some((tab) => tab.group === group.id))
  storage.setItem(
    key,
    JSON.stringify({
      tabs: kept.map(({ url, title, pinned, history, group }) => ({
        url,
        title,
        ...(pinned && { pinned }),
        ...(keptGroups.some((entry) => entry.id === group) && {
          group: keptGroups.findIndex((entry) => entry.id === group)
        }),
        // A history the tab has moved on from is not the one it would resume.
        ...(resumable(history, url) && { history })
      })),
      selected: position === -1 ? kept.length - 1 : position,
      ...(keptGroups.length > 0 && {
        groups: keptGroups.map(({ title, color, collapsed }) => ({ title, color, ...(collapsed && { collapsed }) }))
      })
    } satisfies SavedTabs)
  )
}
