import type { ApplicationToolContext } from "@alwith/module-chat/client"
import { expect, test } from "vitest"

import { createBoardTools } from "@/agent/board-tools"

import { BOARD_FILE, createBoardStore } from "../store"
import { memoryFiles } from "./memory-files"

test("a conversation pins what it found, links it with a reason, and sees what the person selected", async () => {
  const files = memoryFiles()
  const store = createBoardStore("/project", files)
  const tools = Object.fromEntries(createBoardTools(store).map((tool) => [tool.name, tool]))
  const call = async (name: string, input: unknown) =>
    JSON.parse(
      ((await tools[name].execute(input, {} as ApplicationToolContext)).content[0] as { text: string }).text
    ) as { created?: string[]; cards: Record<string, string>[]; links: unknown[]; selected: string[] }

  expect(await call("board_read", {})).toEqual({ cards: [], links: [], selected: [] })
  const built = await call("board_edit", {
    operations: [
      { op: "put", id: "call", file: "notes/call.md", subpath: "#Price" },
      { op: "put", id: "quote", url: "https://example.com/quote" },
      { op: "put", text: "> Unit price 48\\n\\n[March quote](https://example.com/quote)" },
      { op: "link", source: "call", target: "quote", label: "same supplier" }
    ]
  })
  expect(built.created).toHaveLength(3)
  expect(built.cards.slice(0, 2)).toEqual([
    { id: "call", type: "file", file: "notes/call.md", subpath: "#Price" },
    { id: "quote", type: "link", url: "https://example.com/quote" }
  ])
  expect(built.links).toEqual([{ source: "call", target: "quote", label: "same supplier" }])
  // The project file is a JSON Canvas document another application can open.
  const saved = JSON.parse(files.text(`/project/${BOARD_FILE}`)) as { nodes: object[]; edges: object[] }
  expect(saved.nodes[0]).toEqual({
    id: "call",
    type: "file",
    file: "notes/call.md",
    subpath: "#Price",
    x: 0,
    y: 0,
    width: 400,
    height: 300
  })
  expect(saved.edges).toEqual([
    { id: "call-quote", fromNode: "call", toNode: "quote", toEnd: "none", label: "same supplier" }
  ])

  const edited = await call("board_edit", {
    operations: [
      { op: "put", id: "quote", text: "Unit price 45" },
      { op: "link", source: "quote", target: "call", label: "price mismatch" }
    ]
  })
  expect(edited.created).toEqual([])
  expect(edited.cards[1]).toEqual({ id: "quote", type: "text", text: "Unit price 45" })
  expect(edited.links).toEqual([{ source: "call", target: "quote", label: "price mismatch" }])

  store.select(["quote", "gone"])
  expect((await call("board_read", {})).selected).toEqual(["quote"])

  // A failed batch changes nothing, and malformed arguments are rejected.
  await expect(
    call("board_edit", {
      operations: [
        { op: "put", id: "extra", text: "x" },
        { op: "link", source: "extra", target: "gone" }
      ]
    })
  ).rejects.toThrow("two existing nodes")
  await expect(call("board_edit", { operations: [{ op: "put", text: "x", url: "https://a.b" }] })).rejects.toThrow(
    "exactly one"
  )
  expect((await call("board_read", {})).cards).toHaveLength(3)
  expect(() => tools.board_edit.execute({ operations: [{ op: "put", kind: "note" }] }, {} as never)).toThrow(
    "Unexpected board argument"
  )
})
