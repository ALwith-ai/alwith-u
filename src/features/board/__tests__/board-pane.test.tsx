import { connect, emptyCanvas, parseCanvas, putNode, serializeCanvas } from "@nyssance/metro"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, expect, test, vi } from "vitest"

import { BoardPane } from "../board-pane"
import { BOARD_FILE, type BoardStore, createBoardStore } from "../store"
import { memoryFiles } from "./memory-files"

const stores = vi.hoisted(() => ({ current: null as unknown }))
vi.mock("../service", () => ({ showBoard: () => Promise.resolve(stores.current) }))
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
const clipboard = vi.hoisted(() => ({ text: "" }))
vi.mock("@/lib/clipboard", () => ({
  copyText: (value: string) => {
    clipboard.text = value
    return Promise.resolve()
  }
}))
vi.mock("@/components/theme-provider", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }))

let store: BoardStore
beforeEach(() => {
  let board = emptyCanvas()
  board = putNode(board, "call", { type: "file", file: "notes/call.md", subpath: "#Price" })
  board = putNode(board, "quote", { type: "link", url: "https://example.com/quote" })
  board = putNode(board, "doubt", { type: "text", text: "The two prices differ" })
  board = putNode(board, "case", { type: "group", label: "Supplier" })
  store = createBoardStore(
    "/project",
    memoryFiles({
      [`/project/${BOARD_FILE}`]: serializeCanvas(board),
      "/project/notes/call.md": "Agreed on 45 per unit"
    })
  )
  stores.current = store
})

test("each card shows what it stands for: the file itself, the link, the note, the group's name", async () => {
  render(<BoardPane cwd="/project" sessionId={null} onClose={() => {}} />)
  const file = (await screen.findByText("call.md#Price")).closest<HTMLElement>("[data-board-card]")!
  await waitFor(() => expect(file).toHaveTextContent("Agreed on 45 per unit"))
  expect(screen.getByText("example.com").closest("[data-board-card]")).toHaveTextContent("https://example.com/quote")
  expect(screen.getByText("The two prices differ")).toBeInTheDocument()
  expect(screen.getByText("Supplier")).toBeInTheDocument()

  // What a conversation pins appears without reopening the board.
  await store.update((board) => putNode(board, "found", { type: "text", text: "45 against 48" }))
  expect(await screen.findByText("45 against 48")).toBeInTheDocument()
})

test("selecting a card tells the conversation which one is meant, and its field edits the project file", async () => {
  render(<BoardPane cwd="/project" sessionId={null} onClose={() => {}} />)
  fireEvent.click((await screen.findByText("The two prices differ")).closest(".react-flow__node")!)
  await waitFor(async () => expect((await store.read()).selected).toEqual(["doubt"]))

  const field = await screen.findByLabelText("board.text")
  fireEvent.change(field, { target: { value: "45 in the call, 48 in the quote" } })
  fireEvent.blur(field)
  await waitFor(() =>
    expect(store.getSnapshot()?.nodes.find((node) => node.id === "doubt")).toMatchObject({
      text: "45 in the call, 48 in the quote"
    })
  )

  fireEvent.click(screen.getByRole("button", { name: "board.note" }))
  await waitFor(() => expect(store.getSnapshot()!.nodes).toHaveLength(5))
})

test("a note renders its Markdown, edits in place on a double click, and takes a colour", async () => {
  await store.update((board) =>
    putNode(board, "excerpt", { type: "text", text: "> Unit price 48\n\n[March quote](https://example.com/quote)" })
  )
  render(<BoardPane cwd="/project" sessionId={null} onClose={() => {}} />)
  const excerpt = (await screen.findByText("Unit price 48")).closest<HTMLElement>("[data-board-card]")!
  expect(excerpt.querySelector("blockquote")).not.toBeNull()
  expect(excerpt).not.toHaveTextContent("](https://")

  fireEvent.doubleClick(screen.getByText("The two prices differ"))
  const editor = screen.getByRole("textbox", { name: "board.text" })
  fireEvent.change(editor, { target: { value: "45 against 48" } })
  fireEvent.blur(editor)
  await waitFor(() =>
    expect(store.getSnapshot()?.nodes.find((node) => node.id === "doubt")).toMatchObject({ text: "45 against 48" })
  )

  fireEvent.click((await screen.findByText("45 against 48")).closest(".react-flow__node")!)
  fireEvent.click(await screen.findByRole("button", { name: "board.color 4" }))
  await waitFor(() => expect(store.getSnapshot()?.nodes.find((node) => node.id === "doubt")?.color).toBe("4"))
  await waitFor(() => expect(document.querySelector('[data-board-card="doubt"]')).toHaveAttribute("data-color", "4"))
})

test("a change made on the board can be undone and redone, from the toolbar or the keyboard", async () => {
  render(<BoardPane cwd="/project" sessionId={null} onClose={() => {}} />)
  await screen.findByText("The two prices differ")
  const count = () => store.getSnapshot()!.nodes.length
  fireEvent.click(screen.getByRole("button", { name: "board.note" }))
  await waitFor(() => expect(count()).toBe(5))

  fireEvent.click(screen.getByRole("button", { name: "board.undo" }))
  await waitFor(() => expect(count()).toBe(4))
  fireEvent.click(screen.getByRole("button", { name: "board.redo" }))
  await waitFor(() => expect(count()).toBe(5))

  fireEvent.pointerEnter(document.querySelector(".board-pane")!)
  fireEvent.keyDown(document.body, { key: "z", metaKey: true })
  await waitFor(() => expect(count()).toBe(4))
  fireEvent.keyDown(document.body, { key: "z", metaKey: true, shiftKey: true })
  await waitFor(() => expect(count()).toBe(5))
})

test("selected cards copy as a canvas document, paste back as new cards with their link, and can be grouped", async () => {
  await store.update((board) => connect(board, "doubt", "quote", "same supplier"))
  render(<BoardPane cwd="/project" sessionId={null} onClose={() => {}} />)
  await screen.findByText("The two prices differ")
  fireEvent.pointerEnter(document.querySelector(".board-pane")!)
  fireEvent.keyDown(document.body, { key: "a", metaKey: true })
  fireEvent.keyDown(document.body, { key: "c", metaKey: true })
  await waitFor(() => expect(parseCanvas(clipboard.text).nodes).toHaveLength(4))
  expect(parseCanvas(clipboard.text).edges).toHaveLength(1)

  fireEvent.paste(document.body, { clipboardData: { getData: () => clipboard.text } })
  await waitFor(() => expect(store.getSnapshot()!.nodes).toHaveLength(8))
  expect(store.getSnapshot()!.edges).toHaveLength(2)
  // What was pasted is what is selected, so it can be moved or grouped at once.
  await waitFor(async () => expect((await store.read()).selected).toHaveLength(4))
  fireEvent.keyDown(document.body, { key: "g", metaKey: true })
  await waitFor(() => expect(store.getSnapshot()!.nodes.filter((node) => node.type === "group")).toHaveLength(3))

  fireEvent.change(screen.getByRole("searchbox", { name: "board.search" }), { target: { value: "prices" } })
  await waitFor(async () => expect((await store.read()).selected).toHaveLength(2))
})
