import { findTextSourceMatches, literalMatches } from "@alwith/module-chat/search-source"
import { describe, expect, test } from "vitest"

describe("shared source and DOM matching contract", () => {
  test("case-insensitive Unicode matches preserve original UTF-16 offsets", () => {
    expect([...literalMatches("İX 😀x K", "x")]).toEqual([
      { start: 1, end: 2 },
      { start: 5, end: 6 }
    ])
    expect([...literalMatches("İ", "i")]).toEqual([])
    expect([...literalMatches("K", "k")]).toEqual([{ start: 0, end: 1 }])
    expect([...literalMatches("ſ", "s")]).toEqual([{ start: 0, end: 1 }])
  })

  test("queries are literal, non-overlapping and empty queries have no hits", () => {
    const punctuation = [".", "*", "+", "?", "^", "$", "{", "}", "(", ")", "|", "[", "]", "\\"].join("")
    expect([...literalMatches(`before ${punctuation} after`, punctuation)]).toEqual([
      { start: 7, end: 7 + punctuation.length }
    ])
    expect([...literalMatches("aaaaa", "aa")]).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 }
    ])
    expect([...literalMatches("text", "")]).toEqual([])
  })

  test("turn-local ordinals do not manufacture matches across independent fields", () => {
    const turns = [
      { turnKey: "first", segments: ["needle", "NEEDLE"] },
      { turnKey: "second", segments: ["needle"] }
    ]
    expect(findTextSourceMatches(turns, "needle")).toEqual([
      { turnKey: "first", occurrenceInTurn: 0 },
      { turnKey: "first", occurrenceInTurn: 1 },
      { turnKey: "second", occurrenceInTurn: 0 }
    ])
    expect(findTextSourceMatches(turns, "needle\nneedle")).toEqual([])
    expect(findTextSourceMatches([{ turnKey: "third", segments: ["needle\nneedle"] }], "needle\nneedle")).toEqual([
      { turnKey: "third", occurrenceInTurn: 0 }
    ])
  })
})
