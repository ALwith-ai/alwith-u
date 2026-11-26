import { expect, test } from "vitest"

import { match, passes, searchable, searchQuery } from "../match"
import { fold, latin } from "../text"

const score = (query: string, name: string) => match(searchQuery(query), searchable(name))?.score ?? null

test("folds width, case and Latin accents, and leaves other scripts alone", () => {
  expect(fold("ＣＡＦÉ Noir")).toBe("cafe noir")
  expect(fold("微信")).toBe("微信")
  expect(fold("がぎ")).toBe("がぎ")
})

test("reads Han as spaced pinyin and returns other text unchanged", () => {
  expect(latin("微信")).toBe("wei xin")
  expect(latin("网易云音乐")).toBe("wang yi yun yin yue")
  expect(latin("QQ音乐 Pro")).toBe("QQ yin yue Pro")
  expect(latin("Safari")).toBe("Safari")
})

test("scores the first character, word starts, other characters and gaps", () => {
  expect(score("s", "Safari")).toBe(4)
  // First on first (4), then two adjacent characters (2 + 2).
  expect(score("saf", "Safari")).toBe(8)
  // Word starts: V, S, C.
  expect(score("vsc", "Visual Studio Code")).toBe(4 + (3 - 1) + (3 - 1))
  // A run inside a word scores 2 a character.
  expect(score("code", "Xcode")).toBe(8)
  expect(score("zzz", "Safari")).toBeNull()
})

test("starts words at case changes, after digits and at the last capital of a run", () => {
  expect(searchable("OrbStack").wordStarts).toEqual([true, false, false, true, false, false, false, false])
  expect(searchable("1Password").wordStarts.slice(0, 2)).toEqual([true, true])
  // BBEdit: B, then E starts the word "Edit".
  expect(searchable("BBEdit").wordStarts).toEqual([true, false, true, false, false, false])
  expect(score("stack", "OrbStack")).toBe(3 + 2 + 2 + 2 + 2)
})

test("an equal name is exact, whatever its case or width", () => {
  expect(match(searchQuery("SAFARI"), searchable("Safari"))).toEqual({ exact: true, score: Number.POSITIVE_INFINITY })
})

test("a query separator lands on a separator or is skipped", () => {
  // The space lands on the space (2); `c` is then a word start.
  expect(score("vs c", "VS Code")).toBe(4 + 2 + 2 + 3)
  // A space on a hyphen scores 1.
  expect(score("a b", "a-b")).toBe(4 + 1 + 3)
  // Nothing to land on: skipped, and the run stays adjacent.
  expect(score("sa f", "Safari")).toBe(8)
})

test("pinyin initials and full pinyin both reach a Han name through word starts", () => {
  const name = searchable(latin("微信"))
  expect(match(searchQuery("wx"), name)?.score).toBe(4 + 3 - 1)
  expect(match(searchQuery("weixin"), name)?.score).toBe(4 + 2 + 2 + (3 - 1) + 2 + 2)
})

test("medium sensitivity shows runs inside a word and hides scattered letters", () => {
  const shown = (query: string, name: string, sensitivity: "low" | "medium" | "high") => {
    const result = match(searchQuery(query), searchable(name))
    return result !== null && passes(result, searchQuery(query), sensitivity)
  }
  expect(shown("code", "Xcode", "medium")).toBe(true)
  expect(shown("code", "Xcode", "high")).toBe(false)
  expect(shown("vsc", "Visual Studio Code", "high")).toBe(true)
  // Five letters scattered across "System Information": 4 + 1 + 1 + 1 + 1 against a bar of 8.5.
  expect(shown("sfrtn", "System Information", "medium")).toBe(false)
  expect(shown("sfrtn", "System Information", "low")).toBe(true)
})
