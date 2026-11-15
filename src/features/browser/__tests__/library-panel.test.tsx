import "./language"
import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, expect, test, vi } from "vitest"

const { invoke, open } = vi.hoisted(() => ({
  invoke: vi.fn(async (_command: string, _args?: unknown): Promise<unknown> => undefined),
  open: vi.fn(async (): Promise<string | null> => null)
}))
vi.mock("@tauri-apps/api/core", () => ({ invoke }))
vi.mock("@tauri-apps/plugin-dialog", () => ({ open }))

import { libraryStore } from "../library"
import { LibraryPanel } from "../library-panel"

beforeEach(() =>
  libraryStore.setState({
    history: [
      { url: "https://news.example/today", title: "Today", visits: 2, last: 2 },
      { url: "https://docs.example/guide", title: "Guide", visits: 1, last: 1 }
    ],
    bookmarks: [{ url: "https://docs.example/", title: "Docs home" }],
    search: "google"
  })
)

test("bookmarks and history are listed, filtered, opened and forgotten one at a time", () => {
  const onOpen = vi.fn()
  render(<LibraryPanel onOpen={onOpen} onClose={vi.fn()} />)
  fireEvent.click(screen.getByRole("button", { name: /^Docs home/ }))
  expect(onOpen).toHaveBeenLastCalledWith("https://docs.example/")
  fireEvent.click(screen.getByRole("button", { name: "移除书签：Docs home" }))
  expect(libraryStore.getState().bookmarks).toEqual([])
  expect(screen.getByText("还没有书签。")).toBeInTheDocument()

  fireEvent.mouseDown(screen.getByRole("tab", { name: "历史记录" }))
  fireEvent.click(screen.getByRole("tab", { name: "历史记录" }))
  const history = screen.getByRole("tabpanel", { name: "历史记录" })
  expect(within(history).getAllByRole("listitem")).toHaveLength(2)
  fireEvent.change(screen.getByRole("textbox", { name: "筛选书签与历史记录" }), { target: { value: "GUIDE" } })
  expect(within(history).getAllByRole("listitem")).toHaveLength(1)
  fireEvent.click(within(history).getByRole("button", { name: "从历史记录中删除：Guide" }))
  expect(libraryStore.getState().history.map((visit) => visit.url)).toEqual(["https://news.example/today"])
  expect(within(history).getByText("没有匹配的页面。")).toBeInTheDocument()
  fireEvent.change(screen.getByRole("textbox", { name: "筛选书签与历史记录" }), { target: { value: "" } })
  fireEvent.click(screen.getByRole("button", { name: "清除浏览记录" }))
  expect(libraryStore.getState().history).toEqual([])
  expect(screen.getByRole("button", { name: "清除浏览记录" })).toBeDisabled()
})

test("a chosen bookmarks file is merged into the library", async () => {
  render(<LibraryPanel onOpen={vi.fn()} onClose={vi.fn()} />)
  const file = new File(
    ['<DT><A HREF="https://new.example/">New</A><DT><A HREF="https://docs.example/">Dup</A>'],
    "bookmarks.html",
    {
      type: "text/html"
    }
  )
  fireEvent.change(screen.getByLabelText("书签文件"), { target: { files: [file] } })
  await screen.findByRole("button", { name: /^New/ })
  expect(libraryStore.getState().bookmarks).toEqual([
    { url: "https://docs.example/", title: "Docs home" },
    { url: "https://new.example/", title: "New" }
  ])
})

test("saved logins are listed without their passwords and forgotten one at a time", async () => {
  const saved = [
    { origin: "https://shop.example", username: "ada@example.com", used: 2 },
    { origin: "https://mail.example", username: "", used: 1 }
  ]
  invoke.mockImplementation(async (command) => (command === "cef_logins" ? saved : undefined))
  const onOpen = vi.fn()
  render(<LibraryPanel onOpen={onOpen} onClose={vi.fn()} />)
  await act(async () => {})
  fireEvent.mouseDown(screen.getByRole("tab", { name: "已保存的密码" }))
  fireEvent.click(screen.getByRole("tab", { name: "已保存的密码" }))
  const panel = screen.getByRole("tabpanel", { name: "已保存的密码" })
  expect(within(panel).getAllByRole("listitem")).toHaveLength(2)
  expect(panel).toHaveTextContent("（无用户名）")
  fireEvent.click(within(panel).getByRole("button", { name: /^ada@example.com/ }))
  expect(onOpen).toHaveBeenLastCalledWith("https://shop.example")
  fireEvent.click(within(panel).getByRole("button", { name: "删除已保存的密码：ada@example.com https://shop.example" }))
  expect(invoke).toHaveBeenLastCalledWith("cef_delete_login", {
    origin: "https://shop.example",
    username: "ada@example.com"
  })
  await act(async () => {})
  expect(within(panel).getAllByRole("listitem")).toHaveLength(1)
  invoke.mockImplementation(async () => undefined)
})

test("a password file is handed over by its path and the list is read again", async () => {
  let saved = [{ origin: "https://shop.example", username: "ada@example.com", used: 2 }]
  invoke.mockImplementation(async (command) => {
    if (command === "cef_logins") return saved
    if (command !== "cef_import_logins") return undefined
    saved = [...saved, { origin: "https://mail.example", username: "grace", used: 3 }]
    return 1
  })
  render(<LibraryPanel onOpen={vi.fn()} onClose={vi.fn()} />)
  await act(async () => {})
  fireEvent.mouseDown(screen.getByRole("tab", { name: "已保存的密码" }))
  fireEvent.click(screen.getByRole("tab", { name: "已保存的密码" }))
  const panel = screen.getByRole("tabpanel", { name: "已保存的密码" })
  // Leaving the file dialog without a file asks for nothing.
  fireEvent.click(within(panel).getByRole("button", { name: "导入密码文件" }))
  await act(async () => {})
  expect(invoke).not.toHaveBeenCalledWith("cef_import_logins", expect.anything())
  open.mockResolvedValueOnce("/Users/demo/Downloads/passwords.csv")
  fireEvent.click(within(panel).getByRole("button", { name: "导入密码文件" }))
  await act(async () => {})
  expect(invoke).toHaveBeenCalledWith("cef_import_logins", { path: "/Users/demo/Downloads/passwords.csv" })
  expect(within(panel).getAllByRole("listitem")).toHaveLength(2)
  invoke.mockImplementation(async () => undefined)
})
