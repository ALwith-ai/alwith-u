import { createSession, type Item, type MessageItem, type ToolItem } from "@alwith/api"
import { describe, expect, test } from "vitest"
import { groupTurns } from "../../turns"
import { findCodexSearchSourceMatches } from "../codex-search-source"

function message(id: string, kind: MessageItem["kind"], text: string, at: number): MessageItem {
  return { id, kind, content: [{ type: "text", text }], _meta: null, at, replayed: false, echo: null }
}

function tool(id: string, at: number, rawOutput: unknown): ToolItem {
  return {
    id,
    kind: "tool",
    name: "shell",
    title: "ls",
    toolKind: "execute",
    status: "completed",
    content: [],
    locations: [],
    rawInput: { command: "ls" },
    rawOutput,
    _meta: null,
    at,
    replayed: false,
    endedAt: null
  }
}

describe("Codex search source", () => {
  test("searches every unmounted turn in the source data", () => {
    const items: Item[] = [
      message("turn-0", "user", "first question", 1),
      message("answer-0", "assistant", "needle once", 2),
      message("turn-1", "user", "needle twice needle", 3)
    ]
    expect(findCodexSearchSourceMatches(groupTurns({ ...createSession("s", "/"), items }), "needle")).toEqual([
      { occurrenceInTurn: 0, turnKey: "turn:user:turn-0" },
      { occurrenceInTurn: 0, turnKey: "turn:user:turn-1" },
      { occurrenceInTurn: 1, turnKey: "turn:user:turn-1" }
    ])
  })

  test("tool output counts, binary payloads do not", () => {
    const items: Item[] = [
      message("turn-0", "user", "run it", 1),
      tool("call-1", 2, { stdout: "needle in output", data: "needle-in-blob" })
    ]
    expect(findCodexSearchSourceMatches(groupTurns({ ...createSession("s", "/"), items }), "needle")).toEqual([
      { occurrenceInTurn: 0, turnKey: "turn:user:turn-0" }
    ])
  })

  test("an empty query matches nothing", () => {
    expect(
      findCodexSearchSourceMatches(
        groupTurns({ ...createSession("s", "/"), items: [message("turn-0", "user", "text", 1)] }),
        "  "
      )
    ).toEqual([])
  })

  test("an empty query never reads tool payloads", () => {
    const item = tool("unread-output", 2, null)
    const turns = groupTurns({ ...createSession("s", "/"), items: [message("prompt", "user", "run", 1), item] })
    Object.defineProperty(item, "rawOutput", {
      get: () => {
        throw new Error("Empty search read tool output")
      }
    })
    expect(findCodexSearchSourceMatches(turns, "  ")).toEqual([])
  })
})
