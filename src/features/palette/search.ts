import { defaultFilter } from "cmdk"

export interface PaletteSearchGroup<T> {
  id: string
  heading: string
  entries: T[]
}

/** Preserve cmdk's fuzzy ranking and group order without registering the full catalog in the DOM. */
export function searchPalette<T extends { search: string }>(
  groups: PaletteSearchGroup<T>[],
  query: string
): PaletteSearchGroup<T>[] {
  if (query.length === 0) return groups
  return groups
    .map((group) => {
      const matches = group.entries
        .map((entry) => ({ entry, score: defaultFilter(entry.search, query) }))
        .filter((result) => result.score > 0)
        .toSorted((a, b) => b.score - a.score)
      return { ...group, entries: matches.map((result) => result.entry), score: matches[0]?.score ?? 0 }
    })
    .filter((group) => group.entries.length > 0)
    .toSorted((a, b) => b.score - a.score)
}
