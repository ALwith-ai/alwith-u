import i18n from "i18next"
/** The user's own browsing library: visited pages, bookmarks and the search provider. Device-local. */
import { createStore } from "zustand/vanilla"

interface Visit {
  url: string
  title: string
  visits: number
  /** Milliseconds since the epoch of the latest visit. */
  last: number
}
interface Bookmark {
  url: string
  title: string
}
export const searchProviders = {
  google: { name: "Google", url: "https://www.google.com/search?q=" },
  bing: { name: "Bing", url: "https://www.bing.com/search?q=" },
  duckduckgo: { name: "DuckDuckGo", url: "https://duckduckgo.com/?q=" },
  baidu: { name: "百度", url: "https://www.baidu.com/s?wd=" }
} as const
export type SearchProvider = keyof typeof searchProviders
export interface Library {
  history: Visit[]
  bookmarks: Bookmark[]
  search: SearchProvider
}
interface Suggestion {
  url: string
  title: string
  bookmarked: boolean
  /** Open in another tab, which choosing it shows. */
  open?: boolean
}

const key = "alwith.browser.library.v1"
const historyLimit = 2000
const web = (url: unknown): url is string => typeof url === "string" && /^https?:\/\//i.test(url)
const empty: Library = { history: [], bookmarks: [], search: "google" }

function decode(raw: string): Library {
  const value: unknown = JSON.parse(raw)
  if (typeof value !== "object" || value === null) throw new Error("Invalid browser library")
  const { history, bookmarks, search } = value as Record<string, unknown>
  const text = (entry: unknown, field: string) => typeof (entry as Record<string, unknown>)[field] === "string"
  const count = (entry: unknown, field: string) => Number.isFinite((entry as Record<string, unknown>)[field])
  const entries = (list: unknown, valid: (entry: unknown) => boolean) =>
    Array.isArray(list) &&
    list.every((entry) => typeof entry === "object" && entry !== null && web((entry as Bookmark).url) && valid(entry))
  if (
    !entries(history, (entry) => text(entry, "title") && count(entry, "visits") && count(entry, "last")) ||
    !entries(bookmarks, (entry) => text(entry, "title")) ||
    typeof search !== "string" ||
    !(search in searchProviders)
  )
    throw new Error("Invalid browser library")
  return { history: history as Visit[], bookmarks: bookmarks as Bookmark[], search: search as SearchProvider }
}

export function loadLibrary(storage: Pick<Storage, "getItem"> = localStorage): Library {
  const raw = storage.getItem(key)
  return raw === null ? empty : decode(raw)
}

/** A visit moves its page to the front; the oldest pages fall off the end. */
export function recordVisit(history: readonly Visit[], url: string, title: string, now: number): Visit[] {
  if (!web(url)) return [...history]
  const previous = history.find((visit) => visit.url === url)
  return [
    { url, title: title || previous?.title || "", visits: (previous?.visits ?? 0) + 1, last: now },
    ...history.filter((visit) => visit.url !== url)
  ].slice(0, historyLimit)
}

const day = 86_400_000
/** How strongly a page answers what was typed; 0 means it does not. */
function relevance(query: string, url: string, title: string): number {
  const host = new URL(url).host.replace(/^www\./, "")
  const address = url.replace(/^https?:\/\/(www\.)?/i, "").toLowerCase()
  if (host.startsWith(query) || address.startsWith(query)) return 4
  if (host.includes(query)) return 3
  if (title.toLowerCase().includes(query)) return 2
  return address.includes(query) ? 1 : 0
}

/**
 * Pages for what the user is typing: bookmarks, visited pages and pages open in other tabs, the best
 * answer first. A page that is already open is offered as its tab.
 */
export function suggest(
  library: Library,
  input: string,
  now: number,
  limit = 6,
  open: readonly { url: string; title: string }[] = []
): Suggestion[] {
  const query = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, "")
  if (!query) return []
  const bookmarked = new Set(library.bookmarks.map((bookmark) => bookmark.url))
  const visited = new Map(library.history.map((visit) => [visit.url, visit]))
  const shown = new Set(open.map((page) => page.url))
  const pages = new Map<string, string>()
  for (const page of [...open, ...library.bookmarks, ...library.history])
    if (!pages.has(page.url)) pages.set(page.url, page.title)
  return [...pages]
    .map(([url, title]) => {
      const match = relevance(query, url, title)
      const visit = visited.get(url)
      // Often and recently visited pages rise within the same kind of match.
      const habit = visit ? Math.log2(1 + visit.visits) / (1 + (now - visit.last) / (7 * day)) : 0
      return {
        url,
        title,
        bookmarked: bookmarked.has(url),
        open: shown.has(url),
        match,
        // Among equal answers, the page that is already open comes first.
        score: match * 10 + habit + (bookmarked.has(url) ? 1 : 0) + (shown.has(url) ? 2 : 0)
      }
    })
    .filter((page) => page.match > 0)
    .toSorted((a, b) => b.score - a.score || a.url.length - b.url.length)
    .slice(0, limit)
    .map(({ url, title, bookmarked, open }) => ({ url, title, bookmarked, ...(open && { open }) }))
}

/** The pages a start page offers: most used first. */
export function topSites(history: readonly Visit[], limit = 8): Visit[] {
  return history.toSorted((a, b) => b.visits - a.visits || b.last - a.last).slice(0, limit)
}

export const libraryStore = createStore<Library>(() => loadLibrary())
libraryStore.subscribe((library) => localStorage.setItem(key, JSON.stringify(library)))

export const visit = (url: string, title: string) =>
  libraryStore.setState((library) => ({ history: recordVisit(library.history, url, title, Date.now()) }))
/** The title arrives after the visit; it never counts as another one. */
export const retitle = (url: string, title: string) =>
  libraryStore.setState((library) => ({
    history: library.history.map((entry) => (entry.url === url ? { ...entry, title } : entry)),
    bookmarks: library.bookmarks.map((entry) => (entry.url === url && !entry.title ? { ...entry, title } : entry))
  }))
export const clearHistory = () => libraryStore.setState({ history: [] })
export const removeVisit = (url: string) =>
  libraryStore.setState((library) => ({ history: library.history.filter((entry) => entry.url !== url) }))
export const toggleBookmark = (url: string, title: string) =>
  libraryStore.setState((library) => ({
    bookmarks: library.bookmarks.some((bookmark) => bookmark.url === url)
      ? library.bookmarks.filter((bookmark) => bookmark.url !== url)
      : web(url)
        ? [...library.bookmarks, { url, title }]
        : library.bookmarks
  }))
const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'" }

/**
 * Web pages in a bookmarks file the user chose: the HTML export every browser
 * writes, or a Chromium `Bookmarks` file. Folders are flattened.
 */
export function parseBookmarks(file: string): Bookmark[] {
  const pages: Bookmark[] = []
  const add = (url: unknown, title: unknown) => {
    if (web(url)) pages.push({ url, title: typeof title === "string" ? title : "" })
  }
  if (file.trimStart().startsWith("{")) {
    const collect = (node: unknown) => {
      if (typeof node !== "object" || node === null) return
      const { type, url, name, children } = node as Record<string, unknown>
      if (type === "url") add(url, name)
      if (Array.isArray(children)) children.forEach(collect)
    }
    const roots = (JSON.parse(file) as { roots?: unknown }).roots
    if (typeof roots !== "object" || roots === null) throw new Error(i18n.t("browser.notBookmarkFile"))
    Object.values(roots).forEach(collect)
    return pages
  }
  const decode = (text: string) =>
    text.replaceAll(/&(amp|lt|gt|quot|#39|apos);/g, (_, name: string) => entities[name]!).trim()
  for (const [, url, title] of file.matchAll(/<a\s[^>]*?href\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi))
    add(decode(url!), decode(title!.replaceAll(/<[^>]*>/g, "")))
  if (pages.length === 0 && !/<a\s/i.test(file)) throw new Error(i18n.t("browser.notBookmarkFile"))
  return pages
}

/** Add pages the library does not have yet; returns how many were new. */
export function addBookmarks(pages: readonly { url: string; title: string }[]): number {
  let added = 0
  libraryStore.setState((library) => {
    const known = new Set(library.bookmarks.map((bookmark) => bookmark.url))
    const fresh = pages.filter((page) => web(page.url) && !known.has(page.url) && known.add(page.url))
    added = fresh.length
    return { bookmarks: [...library.bookmarks, ...fresh.map(({ url, title }) => ({ url, title }))] }
  })
  return added
}
export const setSearchProvider = (search: SearchProvider) => libraryStore.setState({ search })
