/** Pinned tabs come first; a tab moves only among its own kind. */
interface Ordered {
  id: string
  pinned?: boolean
}

/** Put `moved` where `target` is. A pinned tab is not dragged among the others, nor the other way. */
export function moveTab<T extends Ordered>(tabs: readonly T[], moved: string, target: string): T[] {
  const from = tabs.findIndex((tab) => tab.id === moved)
  const to = tabs.findIndex((tab) => tab.id === target)
  if (from === -1 || to === -1 || from === to || Boolean(tabs[from]!.pinned) !== Boolean(tabs[to]!.pinned))
    return [...tabs]
  const next = [...tabs]
  const [tab] = next.splice(from, 1)
  next.splice(to, 0, tab!)
  return next
}

/** Pin a tab, which takes it to the end of the pinned ones, or unpin it, which takes it to the head of the rest. */
export function pinTab<T extends Ordered>(tabs: readonly T[], id: string, pinned: boolean): T[] {
  const tab = tabs.find((entry) => entry.id === id)
  if (!tab || Boolean(tab.pinned) === pinned) return [...tabs]
  const others = tabs.filter((entry) => entry.id !== id)
  const boundary = others.filter((entry) => entry.pinned).length
  return [...others.slice(0, boundary), { ...tab, pinned }, ...others.slice(boundary)]
}

/** A copy of a tab, placed right after it. */
export function insertAfter<T extends Ordered>(tabs: readonly T[], id: string, created: T): T[] {
  const index = tabs.findIndex((tab) => tab.id === id)
  return index === -1 ? [...tabs, created] : [...tabs.slice(0, index + 1), created, ...tabs.slice(index + 1)]
}

/**
 * Put a tab at a place counted along the whole strip, as an extension asks. It stays among its own kind: a
 * place before the last pinned tab, or after it for a pinned one, is the nearest it may take. Negative is the end.
 */
export function moveTo<T extends Ordered>(tabs: readonly T[], id: string, index: number): T[] {
  const tab = tabs.find((entry) => entry.id === id)
  if (!tab) return [...tabs]
  const others = tabs.filter((entry) => entry.id !== id)
  const boundary = others.filter((entry) => entry.pinned).length
  const [first, last] = tab.pinned ? [0, boundary] : [boundary, others.length]
  const place = index < 0 ? last : Math.min(Math.max(index, first), last)
  return [...others.slice(0, place), tab, ...others.slice(place)]
}
