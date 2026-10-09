import { describe, expect, test } from "vitest"
import { detectTrigger, fileItems, filterSlashCommands } from "../completion"
import { countControlCharsBeforeIndex, sanitizeTextareaValue } from "../prompt-input-clipboard"

const commands = [
  { name: "review", description: "Review uncommitted changes" },
  { name: "review-branch", description: "Review changes relative to a base branch" },
  { name: "compact", description: "Summarize the conversation" },
  { name: "compact", description: "duplicate from a second source" }
]

describe("detectTrigger", () => {
  test("a line-leading slash with the caret after it triggers", () => {
    expect(detectTrigger("/rev", 4)).toEqual({ kind: "slash", start: 0, end: 4, query: "rev" })
    expect(detectTrigger("hello\n/c", 8)).toEqual({ kind: "slash", start: 6, end: 8, query: "c" })
  })
  test("a slash inside a word or path, or whitespace before the caret, does not", () => {
    expect(detectTrigger("src/app", 7)).toBeNull()
    expect(detectTrigger("/review now", 11)).toBeNull()
    expect(detectTrigger("", 0)).toBeNull()
  })
  test("an @ after whitespace or at the start mentions; inside a word it is text", () => {
    expect(detectTrigger("see @cli", 8)).toEqual({ kind: "at", start: 4, end: 8, query: "cli" })
    expect(detectTrigger("@", 1)).toEqual({ kind: "at", start: 0, end: 1, query: "" })
    expect(detectTrigger("mail me@example", 15)).toBeNull()
  })
})

describe("fileItems", () => {
  test("labels the path relative to the root and carries the absolute path", () => {
    const items = fileItems([
      { root: "/repo/", path: "src/app.tsx", match_type: "file", file_name: "app.tsx", score: 1, indices: null },
      { root: "/repo", path: "/abs/x.ts", match_type: "file", file_name: "x.ts", score: 1, indices: null }
    ])
    expect(items.map(item => [item.label, item.payload])).toEqual([
      ["src/app.tsx", "/repo/src/app.tsx"],
      ["/abs/x.ts", "/abs/x.ts"]
    ])
  })
})

describe("filterSlashCommands", () => {
  test("an empty query lists every command once", () => {
    expect(filterSlashCommands(commands, "").map(item => item.payload)).toEqual(["review", "review-branch", "compact"])
  })
  test("fuzzy name matches rank above description matches", () => {
    expect(filterSlashCommands(commands, "rb").map(item => item.payload)).toEqual(["review-branch"])
    expect(filterSlashCommands(commands, "summar").map(item => item.payload)).toEqual(["compact"])
  })
})

describe("sanitizeTextareaValue", () => {
  test("strips control characters but keeps tabs and newlines", () => {
    expect(sanitizeTextareaValue("ab\tc\nd")).toBe("ab\tc\nd")
    expect(countControlCharsBeforeIndex("abc", 4)).toBe(2)
  })
})
