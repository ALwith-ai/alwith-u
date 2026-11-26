const DAY = 24 * 60 * 60 * 1000
/** A visit's weight halves every ten days. */
const HALF_LIFE = 10 * DAY
/** Past search terms steer the order only for an entry opened this recently. */
const TERM_WINDOW = 17 * DAY
const VISIT_WEIGHT = 100
const KEPT_TERMS = 3

/** What the launcher has learned about one entry. Times are milliseconds since the epoch. */
export interface Visit {
  /**
   * When the entry's score decays back to 1. The anchor is kept instead of the score because a later
   * anchor is always the higher score, so the order holds as time passes and nothing is rewritten.
   */
  anchor: number
  openedAt: number
  /** The folded queries the entry was most recently picked for, newest first. */
  terms: string[]
}

export type Usage = Record<string, Visit>

/** An entry's frecency at `now`: 1 for one never opened or long forgotten. */
export function score(visit: Visit | undefined, now: number): number {
  if (visit === undefined) return 1
  return Math.max(1, 2 ** ((visit.anchor - now) / HALF_LIFE))
}

/** The usage after `key` was picked for `query` (folded; empty when it was picked from a list). */
export function visited(usage: Usage, key: string, query: string, now: number): Usage {
  const previous = usage[key]
  const anchor = now + Math.log2(score(previous, now) + VISIT_WEIGHT) * HALF_LIFE
  const earlier = previous === undefined ? [] : previous.terms
  const terms = query.length === 0 ? earlier : [query, ...earlier.filter((term) => term !== query)].slice(0, KEPT_TERMS)
  return { ...usage, [key]: { anchor, openedAt: now, terms } }
}

/** The usage without entries whose score has decayed to that of one never opened. */
export function pruned(usage: Usage, now: number): Usage {
  return Object.fromEntries(Object.entries(usage).filter(([, visit]) => visit.anchor > now))
}

/** The past search terms that still count for an entry at `now`. */
export function liveTerms(visit: Visit | undefined, now: number): string[] {
  if (visit === undefined || visit.anchor <= now || now - visit.openedAt > TERM_WINDOW) return []
  return visit.terms
}
