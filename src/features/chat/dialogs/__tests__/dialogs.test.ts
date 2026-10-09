import type * as acp from "@agentclientprotocol/sdk/experimental/v2"
import { describe, expect, test } from "vitest"
import { filePatch } from "../diff-modal"
import { elicitationFields, initialValues, isAnswered } from "../elicitation-form-dialog"
import { sortPermissionOptions } from "../permission-options"

const twoFiles = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1 +1 @@",
  "-a",
  "+b",
  "diff --git a/src/b.ts b/src/b.ts",
  "--- a/src/b.ts",
  "+++ b/src/b.ts",
  "@@ -1 +1,2 @@",
  " x",
  "+y"
].join("\n")

describe("filePatch", () => {
  test("keeps only the section for the requested path", () => {
    const section = filePatch(twoFiles, "src/b.ts")
    expect(section.startsWith("diff --git a/src/b.ts b/src/b.ts")).toBe(true)
    expect(section).not.toContain("src/a.ts")
  })
  test("returns the whole patch when it has no per-file headers", () => {
    const bare = "@@ -1 +1 @@\n-a\n+b"
    expect(filePatch(bare, "anything")).toBe(bare)
  })
})

describe("sortPermissionOptions", () => {
  test("allow before reject, once before always, whatever the agent sent", () => {
    const options: acp.PermissionOption[] = [
      { optionId: "ra", name: "Never", kind: "reject_always" },
      { optionId: "aa", name: "Always", kind: "allow_always" },
      { optionId: "ro", name: "No", kind: "reject_once" },
      { optionId: "ao", name: "Yes", kind: "allow_once" }
    ]
    expect(sortPermissionOptions(options).map(option => option.optionId)).toEqual(["ao", "aa", "ro", "ra"])
  })
})

describe("elicitation form", () => {
  const schema = {
    type: "object",
    properties: {
      choice: {
        type: "string",
        oneOf: [
          { const: "a", title: "A" },
          { const: "b", title: "B" }
        ]
      },
      tags: { type: "array", items: { type: "string", enum: ["x", "y"] } },
      note: { type: "string" }
    },
    required: ["note"]
  } as unknown as acp.ElicitationSchema

  test("single choices default to their first option, multi choices start empty", () => {
    const fields = elicitationFields(schema)
    const values = initialValues(fields)
    expect(values.choice).toBe("a")
    expect(values.tags).toEqual([])
    expect(values.note).toBeUndefined()
  })

  test("a multi choice needs at least one pick and a required text needs content", () => {
    const [choice, tags, note] = elicitationFields(schema)
    expect(isAnswered(choice, "a")).toBe(true)
    expect(isAnswered(tags, [])).toBe(false)
    expect(isAnswered(tags, ["x"])).toBe(true)
    expect(isAnswered(note, "")).toBe(false)
    expect(isAnswered(note, "done")).toBe(true)
  })
})
