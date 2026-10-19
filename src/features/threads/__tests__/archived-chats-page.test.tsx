import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import type { ThreadSummary } from "@/agent/client"
import { client } from "@/lib/client"
import { initI18n } from "@/lib/i18n"
import { ArchivedChatsPage } from "../archived-chats-page"

await initI18n("en")
const original = client.state
const chats: ThreadSummary[] = [
  { sessionId: "quick", cwd: "/Users/test/Documents/Codex", title: "Shopping list", updatedAt: null, archived: true },
  {
    sessionId: "project",
    cwd: "/work/alpha",
    title: "Release review",
    updatedAt: "2026-10-19T00:00:00Z",
    archived: true
  }
]

beforeEach(() => {
  client.store.setState({ connection: "ready", archivedThreads: [], archivedLoaded: false, archivedCursor: null })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  client.store.setState(original, true)
})

function loadChats(): void {
  vi.spyOn(client, "listThreads").mockImplementation(async () => {
    client.store.setState({ archivedThreads: chats, archivedLoaded: true, archivedCursor: null })
  })
}

test("loads every archive page before searching and deleting all, even when search hides a chat", async () => {
  let finishPage: (() => void) | undefined
  vi.spyOn(client, "listThreads").mockImplementation(async options => {
    if (options?.reset) {
      client.store.setState({ archivedThreads: chats.slice(0, 1), archivedLoaded: true, archivedCursor: "next" })
    } else {
      await new Promise<void>(resolve => {
        finishPage = resolve
      })
      client.store.setState({ archivedThreads: chats, archivedCursor: null })
    }
  })
  const deleted: string[] = []
  vi.spyOn(client, "delete").mockImplementation(async id => {
    deleted.push(id)
    client.store.setState(state => ({
      archivedThreads: state.archivedThreads.filter(thread => thread.sessionId !== id)
    }))
  })
  const view = render(<ArchivedChatsPage />)
  await waitFor(() => expect(finishPage).toBeDefined())
  expect(view.getByRole("button", { name: "Delete all" })).toBeDisabled()
  await act(async () => finishPage?.())
  await waitFor(() => expect(view.getByRole("button", { name: "Delete all" })).toBeEnabled())
  fireEvent.change(view.getByRole("textbox", { name: "Search archived chats" }), { target: { value: "release" } })
  expect(view.queryByText("Shopping list")).not.toBeInTheDocument()
  expect(view.getByText("Release review")).toBeInTheDocument()
  fireEvent.click(view.getByRole("button", { name: "Delete all" }))
  expect(deleted).toEqual([])
  const dialog = view.getByRole("dialog")
  expect(dialog).toHaveTextContent("2")
  await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Delete permanently" })))
  expect(deleted).toEqual(["quick", "project"])
  expect(view.getByText("No archived chats")).toBeInTheDocument()
})

test("restores a chat without opening it and keeps failed deletions available for retry", async () => {
  loadChats()
  vi.spyOn(client, "unarchive").mockImplementation(async id => {
    client.store.setState(state => ({
      archivedThreads: state.archivedThreads.filter(thread => thread.sessionId !== id),
      threads: [
        ...state.threads,
        ...state.archivedThreads
          .filter(thread => thread.sessionId === id)
          .map(thread => ({ ...thread, archived: false }))
      ]
    }))
  })
  vi.spyOn(client, "delete").mockRejectedValue(new Error("Disk is read-only"))
  const view = render(<ArchivedChatsPage />)
  await waitFor(() => expect(view.getByRole("button", { name: "Delete all" })).toBeEnabled())
  const quick = view.getByRole("article", { name: "Shopping list" })
  await act(async () => fireEvent.click(within(quick).getByRole("button", { name: "Unarchive" })))
  expect(view.queryByText("Shopping list")).not.toBeInTheDocument()
  expect(client.state.threads.some(thread => thread.sessionId === "quick" && !thread.archived)).toBe(true)
  fireEvent.click(within(view.getByRole("article", { name: "Release review" })).getByRole("button", { name: "Delete" }))
  await act(async () =>
    fireEvent.click(within(view.getByRole("dialog")).getByRole("button", { name: "Delete permanently" }))
  )
  expect(view.getByRole("dialog")).toHaveTextContent("Disk is read-only")
  fireEvent.click(within(view.getByRole("dialog")).getByRole("button", { name: "Cancel" }))
  expect(view.getByRole("article", { name: "Release review" })).toBeInTheDocument()
})

test("reports a failed archive fetch and retries without enabling destructive actions early", async () => {
  const list = vi.spyOn(client, "listThreads").mockRejectedValue(new Error("Connection lost"))
  const view = render(<ArchivedChatsPage />)
  expect(await view.findByRole("alert")).toHaveTextContent("Connection lost")
  expect(view.getByRole("button", { name: "Delete all" })).toBeDisabled()
  list.mockImplementation(async () => {
    client.store.setState({ archivedThreads: [], archivedLoaded: true, archivedCursor: null })
  })
  fireEvent.click(view.getByRole("button", { name: "Retry" }))
  expect(await view.findByText("No archived chats")).toBeInTheDocument()
})

test("chat type and project filters combine with search and report no matches", async () => {
  loadChats()
  const view = render(<ArchivedChatsPage />)
  await waitFor(() => expect(view.getByRole("button", { name: "Delete all" })).toBeEnabled())
  fireEvent.click(view.getByRole("combobox", { name: "Chat type" }))
  await act(async () => {
    const option = await view.findByRole("option", { name: "Project chats" })
    fireEvent.pointerDown(option, { pointerType: "mouse" })
    fireEvent.click(option)
  })
  expect(view.queryByText("Shopping list")).not.toBeInTheDocument()
  expect(view.getByText("Release review")).toBeInTheDocument()
  fireEvent.click(view.getByRole("combobox", { name: "Project" }))
  await act(async () => {
    const option = await view.findByRole("option", { name: "No project" })
    fireEvent.pointerDown(option, { pointerType: "mouse" })
    fireEvent.click(option)
  })
  expect(view.getByText("No matching archived chats")).toBeInTheDocument()
  fireEvent.click(view.getByRole("combobox", { name: "Project" }))
  await act(async () => {
    const option = await view.findByRole("option", { name: "alpha" })
    fireEvent.pointerDown(option, { pointerType: "mouse" })
    fireEvent.click(option)
  })
  expect(view.getByText("Release review")).toBeInTheDocument()
})

test("batch delete retries only failures and skips chats restored after the confirmation opened", async () => {
  loadChats()
  let fail = true
  const deleted: string[] = []
  vi.spyOn(client, "delete").mockImplementation(async id => {
    if (id === "project" && fail) throw new Error("Unavailable")
    deleted.push(id)
    client.store.setState(state => ({
      archivedThreads: state.archivedThreads.filter(thread => thread.sessionId !== id)
    }))
  })
  const view = render(<ArchivedChatsPage />)
  await waitFor(() => expect(view.getByRole("button", { name: "Delete all" })).toBeEnabled())
  fireEvent.click(view.getByRole("button", { name: "Delete all" }))
  await act(async () =>
    fireEvent.click(within(view.getByRole("dialog")).getByRole("button", { name: "Delete permanently" }))
  )
  expect(deleted).toEqual(["quick"])
  expect(view.getByRole("dialog")).toHaveTextContent("Unavailable")
  fail = false
  await act(async () =>
    fireEvent.click(within(view.getByRole("dialog")).getByRole("button", { name: "Delete permanently" }))
  )
  expect(deleted).toEqual(["quick", "project"])
  expect(view.queryByRole("dialog")).not.toBeInTheDocument()
  await act(async () => client.store.setState({ archivedThreads: chats }))
  fireEvent.click(view.getByRole("button", { name: "Delete all" }))
  await act(async () => client.store.setState({ archivedThreads: [] }))
  await act(async () =>
    fireEvent.click(within(view.getByRole("dialog")).getByRole("button", { name: "Delete permanently" }))
  )
  expect(deleted).toEqual(["quick", "project"])
})

test("repeated archive cursors produce an error instead of enabling partial bulk deletion", async () => {
  vi.spyOn(client, "listThreads").mockImplementation(async () => {
    client.store.setState({ archivedThreads: chats, archivedLoaded: true, archivedCursor: "repeat" })
  })
  const view = render(<ArchivedChatsPage />)
  expect(await view.findByRole("alert")).toHaveTextContent("repeated cursor")
  expect(view.getByRole("button", { name: "Delete all" })).toBeDisabled()
})
