import { defineApplicationTool } from "@alwith/module-chat/client"
import { type CanvasContent, type CanvasDocument, connect, disconnect, putNode, removeNode } from "@nyssance/metro"

/** One project's board. `update` persists the changed board before it resolves. */
export interface BoardService {
  /** The board with the cards the person currently has selected on it. */
  read: () => Promise<{ board: CanvasDocument; selected: readonly string[] }>
  update: (change: (board: CanvasDocument) => CanvasDocument) => Promise<void>
}

type Operation =
  | { op: "put"; id?: string; text?: string; file?: string; subpath?: string; url?: string }
  | { op: "remove"; id: string }
  | { op: "link"; source: string; target: string; label?: string }
  | { op: "unlink"; source: string; target: string }

function fields(input: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, string> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Error("Expected board arguments")
  const args = input as Record<string, unknown>
  for (const key of Object.keys(args))
    if (!required.includes(key) && !optional.includes(key)) throw new Error(`Unexpected board argument: ${key}`)
  for (const key of required) if (typeof args[key] !== "string") throw new Error(`${key} must be text`)
  for (const key of optional) if (key in args && typeof args[key] !== "string") throw new Error(`${key} must be text`)
  return args as Record<string, string>
}

function operation(input: unknown): Operation {
  const op = (input as { op?: unknown } | null)?.op
  if (op === "put") return fields(input, ["op"], ["id", "text", "file", "subpath", "url"]) as unknown as Operation
  if (op === "remove") return fields(input, ["op", "id"]) as unknown as Operation
  if (op === "link") return fields(input, ["op", "source", "target"], ["label"]) as unknown as Operation
  if (op === "unlink") return fields(input, ["op", "source", "target"]) as unknown as Operation
  throw new Error("Each operation needs op: put, remove, link or unlink")
}

/** A put names exactly one of text, file or url; that decides what the card is. */
function contentOf(entry: Extract<Operation, { op: "put" }>): CanvasContent {
  const { text, file, subpath, url } = entry
  if ([text, file, url].filter((value) => value !== undefined).length !== 1 || (subpath !== undefined && !file))
    throw new Error("put takes exactly one of text, file or url; subpath only goes with file")
  if (text !== undefined) return { type: "text", text }
  if (url !== undefined) return { type: "link", url }
  return subpath === undefined ? { type: "file", file: file! } : { type: "file", file: file!, subpath }
}

async function report(service: BoardService) {
  const { board, selected } = await service.read()
  return {
    cards: board.nodes.map(({ id, type, text, file, subpath, url, label }) => ({
      id,
      type,
      text,
      file,
      subpath,
      url,
      label
    })),
    links: board.edges.map(({ fromNode, toNode, label }) => ({ source: fromNode, target: toNode, label: label ?? "" })),
    selected
  }
}

const result = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data) }] })

const operationsSchema = {
  type: "object",
  properties: {
    operations: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          op: { enum: ["put", "remove", "link", "unlink"] },
          id: { type: "string" },
          text: { type: "string" },
          file: { type: "string" },
          subpath: { type: "string" },
          url: { type: "string" },
          source: { type: "string" },
          target: { type: "string" },
          label: { type: "string" }
        },
        required: ["op"],
        additionalProperties: false
      }
    }
  },
  required: ["operations"],
  additionalProperties: false
}

function parseOperations(input: unknown) {
  const operations = (input as { operations?: unknown } | null)?.operations
  if (!Array.isArray(operations) || operations.length === 0 || Object.keys(input as object).length !== 1)
    throw new Error("operations must be a non-empty list")
  return { operations: operations.map(operation) }
}

async function apply(service: BoardService, operations: readonly Operation[]) {
  const created: string[] = []
  await service.update((board) => {
    created.length = 0
    for (const entry of operations) {
      if (entry.op === "put") {
        const id = entry.id ?? crypto.randomUUID()
        if (!board.nodes.some((node) => node.id === id)) created.push(id)
        board = putNode(board, id, contentOf(entry))
      } else if (entry.op === "remove") board = removeNode(board, entry.id)
      else if (entry.op === "link") board = connect(board, entry.source, entry.target, entry.label ?? "")
      else board = disconnect(board, entry.source, entry.target)
    }
    return board
  })
  return result({ created, ...(await report(service)) })
}

/** Conversations and the person arrange the same project board through these operations. */
export function createBoardTools(service: BoardService) {
  return [
    defineApplicationTool({
      name: "board_read",
      description:
        "Read this project's board: the cards the user has laid out, the links drawn between them with their reasons (a group card is a labelled area around others), and `selected`, the cards the user has selected right now. When the user refers to what is on the board, to selected cards, or asks how things there relate, read it first and reason over the links.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      parse(input: unknown) {
        return fields(input ?? {}, [])
      },
      async execute() {
        return result(await report(service))
      }
    }),
    defineApplicationTool({
      name: "board_edit",
      description:
        "Lay things out on this project's board, which the user sees as a canvas of cards. `put` adds a card, or with an existing id replaces what it is. Give exactly one of: `file`, a project-relative path, shown as the file itself, with an optional `subpath` such as `#Heading` to point at one part; `url`, an absolute link; or `text`, Markdown. For an excerpt, put `text` with the exact passage, figure or row that matters as a quote, followed by a Markdown link to the file or page it comes from. Use one card per finding rather than one long card. `link` relates two cards, with `label` as the short reason they belong together; propose a link only when you can state the reason. `remove` and `unlink` take things off. Operations apply in order, all or none.",
      inputSchema: operationsSchema,
      // The board is a file of the project the conversation already works in; it reaches nothing outside it.
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      parse: parseOperations,
      execute: ({ operations }) => apply(service, operations)
    })
  ]
}
