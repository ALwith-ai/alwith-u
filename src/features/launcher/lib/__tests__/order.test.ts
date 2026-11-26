import { expect, test } from "vitest"

import { browse, type Entry, index, rank } from "../order"
import { liveTerms, pruned, score, type Usage, visited } from "../usage"

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 10, 26)

function entry(title: string, fields: Partial<Entry> = {}): Entry {
  return { id: title, kind: "application", title, alternates: [], subtitle: "", alias: "", ...fields }
}

function titles(entries: Entry[], query: string, usage: Usage = {}): string[] {
  return rank(entries.map(index), query, usage, NOW).map((result) => result.title)
}

test("an empty query ranks nothing and a query lists only what matches", () => {
  const entries = [entry("Safari"), entry("Notes")]
  expect(titles(entries, "  ")).toEqual([])
  expect(titles(entries, "saf")).toEqual(["Safari"])
})

test("a title that starts with the query beats one that reaches the same score by skipping", () => {
  expect(titles([entry("AirPort Utility"), entry("App Store")], "ap")).toEqual(["App Store", "AirPort Utility"])
})

test("a Han name is found by its characters, its pinyin and its initials", () => {
  const entries = [entry("微信"), entry("Xcode")]
  expect(titles(entries, "微信")).toEqual(["微信"])
  expect(titles(entries, "weixin")).toEqual(["微信"])
  expect(titles(entries, "wx")).toEqual(["微信"])
})

test("an alternate title is matched as typed", () => {
  expect(titles([entry("访达", { alternates: ["Finder"] }), entry("Find My")], "finder")).toEqual(["访达"])
})

test("an exact alias outranks an exact title, and an alias prefix outranks a better score", () => {
  const entries = [entry("Code"), entry("Visual Studio Code", { alias: "code" })]
  expect(titles(entries, "code")).toEqual(["Visual Studio Code", "Code"])
  expect(titles([entry("Terminal"), entry("Ghostty", { alias: "term" })], "te")).toEqual(["Ghostty", "Terminal"])
})

test("an alias hit away from its start ranks only as another name", () => {
  expect(titles([entry("Terminal"), entry("iTerm", { alias: "my iterm" })], "term")).toEqual(["Terminal", "iTerm"])
})

test("the entry last picked for a query leads that query, until the habit goes stale", () => {
  const entries = [entry("Safari"), entry("Sublime Text")]
  expect(titles(entries, "s")).toEqual(["Safari", "Sublime Text"])
  const usage = visited({}, "Sublime Text", "s", NOW - DAY)
  expect(titles(entries, "s", usage)).toEqual(["Sublime Text", "Safari"])
  const stale = visited({}, "Sublime Text", "s", NOW - 18 * DAY)
  expect(liveTerms(stale["Sublime Text"], NOW)).toEqual([])
  // The term no longer counts, and at equal score frecency still prefers the entry that was opened.
  expect(titles(entries, "sa", stale)).toEqual(["Safari"])
})

test("at equal score the more used entry leads, and applications win what is left", () => {
  const entries = [entry("Notes"), entry("Notion")]
  expect(titles(entries, "not")).toEqual(["Notes", "Notion"])
  expect(titles(entries, "not", visited({}, "Notion", "", NOW - DAY))).toEqual(["Notion", "Notes"])
  expect(titles([entry("Settings", { kind: "command" }), entry("Settings", { id: "app" })], "sett")).toEqual([
    "Settings",
    "Settings"
  ])
  expect(
    rank([entry("Settings", { kind: "command" }), entry("Settings", { id: "app" })].map(index), "sett", {}, NOW)[0].id
  ).toBe("app")
})

test("an exact subtitle lists an entry above a title that merely starts with the query", () => {
  const entries = [entry("Zedis"), entry("Open project", { kind: "command", subtitle: "Zed" })]
  expect(titles(entries, "zed")).toEqual(["Open project", "Zedis"])
})

test("a visit adds a hundred, decays by half in ten days and remembers three distinct terms", () => {
  let usage = visited({}, "a", "one", NOW)
  expect(score(usage.a, NOW)).toBeCloseTo(101)
  expect(score(usage.a, NOW + 10 * DAY)).toBeCloseTo(50.5)
  usage = visited(usage, "a", "two", NOW)
  expect(score(usage.a, NOW)).toBeCloseTo(201)
  usage = visited(visited(visited(usage, "a", "one", NOW), "a", "three", NOW), "a", "four", NOW)
  expect(usage.a.terms).toEqual(["four", "three", "one"])
  expect(score(undefined, NOW)).toBe(1)
  expect(pruned(usage, NOW + 365 * DAY)).toEqual({})
})

test("an empty query lists what is used first, then applications, then the rest by name", () => {
  const entries = [entry("Zed"), entry("Build", { kind: "command" }), entry("Arc"), entry("Notes")]
  const usage = visited({}, "Notes", "", NOW)
  expect(browse(entries.map(index), usage, NOW).map((result) => result.title)).toEqual(["Notes", "Arc", "Zed", "Build"])
})

test("a name that starts with the query as written leads one reached through its pinyin", () => {
  expect(titles([entry("色彩同步实用工具"), entry("Safari浏览器")], "s")).toEqual(["Safari浏览器", "色彩同步实用工具"])
})
