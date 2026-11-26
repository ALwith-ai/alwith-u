import { fold } from "./text"

const SEPARATORS = new Set([" ", "\t", "\n", "-", ".", "/", "(", ")", "[", "]"])
const LOWER = /\p{Ll}/u
const UPPER = /\p{Lu}/u
const DIGIT = /\p{Nd}/u
const LETTER = /\p{L}/u

/** A name prepared once for matching: its folded characters and where its words start. */
export interface Searchable {
  folded: string
  characters: string[]
  wordStarts: boolean[]
}

/** How well a query aligns with one name. `exact` outranks every score. */
export interface Match {
  exact: boolean
  score: number
}

/** How loose a hit may be before it stops being shown. */
export type Sensitivity = "low" | "medium" | "high"

/**
 * Words start after a separator, at a capital after a lowercase letter (`OrbStack`), at a letter
 * after a digit (`1Password`), and at the last capital of a run that a lowercase letter follows
 * (`BBEdit`).
 */
export function searchable(text: string): Searchable {
  const original = [...text.normalize("NFKC")]
  const characters: string[] = []
  const wordStarts: boolean[] = []
  for (const [index, character] of original.entries()) {
    const previous = original[index - 1]
    const next = original[index + 1]
    const starts =
      previous === undefined ||
      SEPARATORS.has(previous) ||
      (UPPER.test(character) && LOWER.test(previous)) ||
      (LETTER.test(character) && DIGIT.test(previous)) ||
      (UPPER.test(character) && UPPER.test(previous) && next !== undefined && LOWER.test(next))
    // A character may fold to several (or none); every one of them keeps its source position.
    for (const [part, folded] of [...fold(character)].entries()) {
      characters.push(folded)
      wordStarts.push(starts && part === 0 && !SEPARATORS.has(character))
    }
  }
  return { folded: characters.join(""), characters, wordStarts }
}

/** The query as it is compared: folded, with its outer whitespace dropped. */
export function searchQuery(text: string): string {
  return fold(text).trim()
}

/**
 * The best alignment of `query` (already folded) over a name, or `null` when it does not align.
 *
 * A matched character scores 4 for the query's first on the name's first, 3 on a word start, 2
 * anywhere else (a separator on the same separator included) and 1 for a separator on a different
 * one; a character that does not follow the previous match directly costs 1. A query separator with
 * nothing to land on is skipped.
 */
export function match(query: string, name: Searchable): Match | null {
  if (query.length === 0) return null
  if (query === name.folded) return { exact: true, score: Number.POSITIVE_INFINITY }
  const wanted = [...query]
  const length = name.characters.length
  // `ending[j]`: the best score of the query so far with its last match on name character j.
  let ending: number[] = new Array<number>(length).fill(Number.NEGATIVE_INFINITY)
  // `open`: the best score of the query so far when nothing has matched yet, or -Infinity.
  let open = 0
  for (const [position, character] of wanted.entries()) {
    const separator = SEPARATORS.has(character)
    const next: number[] = new Array<number>(length).fill(Number.NEGATIVE_INFINITY)
    let earlier = Number.NEGATIVE_INFINITY
    for (let index = 0; index < length; index += 1) {
      // `earlier` is the best of ending[0 .. index - 2]: a match that is not adjacent.
      if (index >= 2) earlier = Math.max(earlier, ending[index - 2])
      const candidate = name.characters[index]
      const points = separator
        ? SEPARATORS.has(candidate)
          ? candidate === character
            ? 2
            : 1
          : 0
        : candidate === character
          ? position === 0 && index === 0
            ? 4
            : name.wordStarts[index]
              ? 3
              : 2
          : 0
      if (points === 0) continue
      const adjacent = index >= 1 ? ending[index - 1] : Number.NEGATIVE_INFINITY
      next[index] = Math.max(open, adjacent, earlier - 1) + points
    }
    if (separator) {
      // Skipping the separator keeps every alignment reached so far.
      for (let index = 0; index < length; index += 1) next[index] = Math.max(next[index], ending[index])
    } else {
      open = Number.NEGATIVE_INFINITY
    }
    ending = next
  }
  const score = Math.max(open, ...ending)
  return score === Number.NEGATIVE_INFINITY || score <= 0 ? null : { exact: false, score }
}

/** Whether a hit is strong enough to show. The length counts the query without its separators. */
export function passes(result: Match, query: string, sensitivity: Sensitivity): boolean {
  if (result.exact || sensitivity === "low") return true
  const length = [...query].filter((character) => !SEPARATORS.has(character)).length
  return sensitivity === "medium" ? result.score >= 1.5 * (length - 2) + 4 : result.score > 2 * length
}
