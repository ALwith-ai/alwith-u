import { type Match, match, passes, type Searchable, searchable, searchQuery, type Sensitivity } from "./match"
import { fold, latin } from "./text"
import { liveTerms, score as frecency, type Usage } from "./usage"

export type EntryKind = "application" | "command" | "session" | "project"

/** Applications win the ties, so an application is never shadowed by a command named after it. */
const KIND_PRIORITY: Record<EntryKind, number> = { application: 4, command: 3, session: 2, project: 2 }

/** One thing the launcher can open, as its source names it. */
export interface Entry {
  /** Stable across launches; usage and aliases are kept under it. */
  id: string
  kind: EntryKind
  title: string
  /** Other names the entry answers to, matched as typed: a file name, a name in another language. */
  alternates: string[]
  subtitle: string
  /** A name the user chose for the entry. */
  alias: string
}

/** An entry with its names prepared for matching; built once per catalog change, never per keystroke. */
export interface Indexed {
  entry: Entry
  title: Searchable
  alternates: Searchable[]
  subtitle: Searchable | null
  alias: string
}

export function index(entry: Entry): Indexed {
  const reading = latin(entry.title)
  return {
    entry,
    title: searchable(reading),
    // A name in another script is found by its Latin reading and by itself.
    alternates: [...(reading === entry.title ? [] : [entry.title]), ...entry.alternates].map(searchable),
    subtitle: entry.subtitle.length === 0 ? null : searchable(latin(entry.subtitle)),
    alias: fold(entry.alias)
  }
}

interface Ranked {
  indexed: Indexed
  /** Each rule's value, most decisive first; the first that differs orders two entries. */
  keys: number[]
}

function best(...results: (Match | null)[]): Match | null {
  return results.reduce<Match | null>(
    (winner, result) => (result !== null && (winner === null || result.score > winner.score) ? result : winner),
    null
  )
}

/**
 * The entries a query shows, best first. An entry appears when its alias is an exact or prefix hit
 * or when one of its names passes the sensitivity. The first rule that separates two entries decides:
 *
 * 1. an exact alias;
 * 2. past three characters, an exact title or alternate title;
 * 3. a past search term equal to the query;
 * 4. an exact subtitle;
 * 5. an alias that starts with the query;
 * 6. a past search term that starts with the query;
 * 7. the best score over the title, alternate titles and subtitle;
 * 8. frecency;
 * 9. the title's own score;
 * 10. a title or alternate title that starts with the query;
 * 11. a title that starts with the query as written, before one reached through its reading;
 * 12. the kind;
 * 13. the name, compared numerically.
 */
export function rank(
  catalog: Indexed[],
  typed: string,
  usage: Usage,
  now: number,
  sensitivity: Sensitivity = "medium"
): Entry[] {
  const query = searchQuery(typed)
  if (query.length === 0) return []
  const long = [...query].length > 3
  const ranked: Ranked[] = []
  for (const indexed of catalog) {
    const title = match(query, indexed.title)
    const alternates = indexed.alternates.map((alternate) => match(query, alternate))
    const subtitle = indexed.subtitle === null ? null : match(query, indexed.subtitle)
    const aliasExact = indexed.alias.length > 0 && indexed.alias === query
    const aliasPrefix = indexed.alias.length > 0 && indexed.alias.startsWith(query)
    // An alias that is neither counts as one more alternate title.
    const alias = indexed.alias.length === 0 || aliasPrefix ? null : match(query, searchable(indexed.alias))
    const names = best(title, ...alternates, subtitle, alias)
    if (!aliasPrefix && (names === null || !passes(names, query, sensitivity))) continue
    const visit = usage[indexed.entry.id]
    const terms = liveTerms(visit, now)
    const titled = [title, ...alternates]
    ranked.push({
      indexed,
      keys: [
        Number(aliasExact),
        Number(long && titled.some((result) => result?.exact)),
        Number(terms.includes(query)),
        Number(subtitle?.exact ?? false),
        Number(aliasPrefix),
        Number(terms.some((term) => term.startsWith(query))),
        names === null ? 0 : names.exact ? Number.MAX_VALUE : names.score,
        frecency(visit, now),
        title === null ? 0 : title.exact ? Number.MAX_VALUE : title.score,
        Number(
          indexed.title.folded.startsWith(query) ||
            indexed.alternates.some((alternate) => alternate.folded.startsWith(query))
        ),
        // A name that starts with the query as written leads one reached through its reading:
        // `s` is Safari before it is `色彩` (se cai).
        Number(fold(indexed.entry.title).startsWith(query)),
        KIND_PRIORITY[indexed.entry.kind]
      ]
    })
  }
  return ranked
    .toSorted((a, b) => {
      for (const [position, value] of a.keys.entries()) {
        if (value !== b.keys[position]) return b.keys[position] - value
      }
      return a.indexed.entry.title.localeCompare(b.indexed.entry.title, undefined, { numeric: true })
    })
    .map((result) => result.indexed.entry)
}

/** What an empty query lists: what the user opens first, then the rest by kind and name. */
export function browse(catalog: Indexed[], usage: Usage, now: number): Entry[] {
  return catalog
    .map((indexed) => indexed.entry)
    .toSorted(
      (a, b) =>
        frecency(usage[b.id], now) - frecency(usage[a.id], now) ||
        KIND_PRIORITY[b.kind] - KIND_PRIORITY[a.kind] ||
        a.title.localeCompare(b.title, undefined, { numeric: true })
    )
}
