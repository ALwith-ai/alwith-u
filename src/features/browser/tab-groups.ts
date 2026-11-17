/** Tabs the user keeps together under a name and a colour. A group's tabs stand side by side in the strip. */
export const groupColors = [1, 2, 3, 4, 5] as const
export type GroupColor = (typeof groupColors)[number]
export interface TabGroup {
  id: string
  title: string
  color: GroupColor
  /** Its tabs are put away behind its name. */
  collapsed?: boolean
  /** The conversation whose pages this managed group contains. */
  sessionId?: string
}
interface Grouped {
  id: string
  pinned?: boolean
  group?: string
}

/** Reuse one visible group per conversation, independent of the window hosting its chat. */
export function addSessionTab<T extends Grouped>(
  tabs: readonly T[],
  groups: readonly TabGroup[],
  tab: T,
  sessionId?: string
) {
  if (!sessionId) return { tabs: [...tabs, tab], groups: [...groups] }
  const id = `ai:${sessionId}`
  const existing = groups.find((group) => group.id === id)
  const index = groups.filter((group) => group.sessionId).length
  const group: TabGroup = existing ?? {
    id,
    sessionId,
    title: `AI ${index + 1}`,
    color: groupColors[index % groupColors.length]!
  }
  return {
    tabs: joinGroup([...tabs, tab], tab.id, id),
    groups: existing
      ? groups.map((entry) => (entry.id === id ? { ...entry, collapsed: false } : entry))
      : [...groups, group]
  }
}

/** Put a tab in a group, after the tabs the group already has. A pinned tab stays out. */
export function joinGroup<T extends Grouped>(tabs: readonly T[], id: string, group: string): T[] {
  const tab = tabs.find((entry) => entry.id === id)
  if (!tab || tab.pinned || tab.group === group) return [...tabs]
  const others = tabs.filter((entry) => entry.id !== id)
  const last = others.findLastIndex((entry) => entry.group === group)
  const joined = { ...tab, group }
  if (last === -1) return tabs.map((entry) => (entry.id === id ? joined : entry))
  return [...others.slice(0, last + 1), joined, ...others.slice(last + 1)]
}

/** Take a tab out of its group, to just after the tabs that stay in it. */
export function leaveGroup<T extends Grouped>(tabs: readonly T[], id: string): T[] {
  const tab = tabs.find((entry) => entry.id === id)
  if (!tab || tab.group === undefined) return [...tabs]
  const others = tabs.filter((entry) => entry.id !== id)
  const last = others.findLastIndex((entry) => entry.group === tab.group)
  const free = { ...tab, group: undefined }
  if (last === -1) return tabs.map((entry) => (entry.id === id ? free : entry))
  return [...others.slice(0, last + 1), free, ...others.slice(last + 1)]
}

/**
 * The group of a tab that was just moved along the strip: dropped between two tabs of one group it joins them;
 * taken away from the other tabs of its own it leaves; alone in its group it takes the group along.
 */
export function settleGroup<T extends Grouped>(tabs: readonly T[], id: string): T[] {
  const index = tabs.findIndex((entry) => entry.id === id)
  const tab = tabs[index]
  if (!tab) return [...tabs]
  const before = tabs[index - 1]?.group
  const after = tabs[index + 1]?.group
  const alone = tab.group !== undefined && !tabs.some((entry) => entry.id !== id && entry.group === tab.group)
  const group = tab.pinned
    ? undefined
    : before !== undefined && before === after
      ? before
      : alone || (tab.group !== undefined && (before === tab.group || after === tab.group))
        ? tab.group
        : undefined
  return group === tab.group ? [...tabs] : tabs.map((entry) => (entry.id === id ? { ...entry, group } : entry))
}

/** The groups that still have a tab. */
export const usedGroups = (groups: readonly TabGroup[], tabs: readonly Grouped[]) =>
  groups.filter((group) => tabs.some((tab) => tab.group === group.id))
