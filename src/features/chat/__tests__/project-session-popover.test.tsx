import { act, fireEvent, render, waitFor } from "@testing-library/react"
import { afterAll, expect, spyOn, test } from "bun:test"
import * as opener from "@tauri-apps/plugin-opener"
import type { ThreadSummary } from "@/agent/client"
import { client } from "@/lib/client"
import { must } from "@/lib/__tests__/must"
import { initI18n } from "@/lib/i18n"
import { ProjectSessionPopover } from "../project-session-popover"
import { installDom } from "../codex/__tests__/dom-environment"

installDom()
await initI18n("en")
const connect = spyOn(client, "connect").mockResolvedValue()
// Restore this shared singleton before subsequent test files run.
afterAll(() => connect.mockRestore())

function threads(cwd = "/tmp/project"): ThreadSummary[] {
  return Array.from({ length: 7 }, (_, index) => ({
    sessionId: `chat-${index}`,
    cwd,
    title: `Chat ${index}`,
    updatedAt: `2026-09-0${index + 1}T00:00:00Z`,
    archived: false
  }))
}

test("project popover shows the full count, expands beyond five chats and routes the selected thread", async () => {
  const entries = threads()
  const list = spyOn(client, "listProjectThreads").mockResolvedValue(entries)
  const selected: ThreadSummary[] = []
  try {
    const view = render(
      <ProjectSessionPopover cwd="/tmp/project" onSelect={thread => selected.push(thread)} onNewChat={() => {}} />
    )
    expect(list).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "project" }))
    })
    expect(list).toHaveBeenCalledWith("/tmp/project")
    expect(view.getByText("7 chats")).toBeDefined()
    expect(view.getAllByRole("button", { name: /^Chat / })).toHaveLength(5)
    expect(view.getAllByRole("button", { name: /^Chat / })[0]?.textContent).toContain("Chat 6")
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Show more" }))
    })
    expect(view.getAllByRole("button", { name: /^Chat / })).toHaveLength(7)
    expect(view.queryByRole("button", { name: /collection|favorite/i })).toBeNull()
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Chat 0", exact: true }))
    })
    expect(selected[0]?.sessionId).toBe("chat-0")
    expect(selected[0]?.cwd).toBe("/tmp/project")
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull())
  } finally {
    list.mockRestore()
  }
})

test("loading and failure never advertise a partial total, and retry reloads the project", async () => {
  let reject!: (error: Error) => void
  const list = spyOn(client, "listProjectThreads")
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail
        })
    )
    .mockResolvedValue([])
  try {
    const view = render(<ProjectSessionPopover cwd="/tmp/project" onSelect={() => {}} onNewChat={() => {}} />)
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "project" }))
    })
    expect(view.getByRole("status").textContent).toContain("Loading chats")
    expect(view.queryByText(/\d+ chats?/)).toBeNull()
    await act(async () => {
      reject(new Error("Could not load next page"))
    })
    expect(view.getByRole("alert").textContent).toBe("Could not load next page")
    expect(view.queryByText(/\d+ chats?/)).toBeNull()
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Retry" }))
    })
    expect(view.getByText("0 chats")).toBeDefined()
    expect(list).toHaveBeenCalledTimes(2)
  } finally {
    list.mockRestore()
  }
})

test("project actions open the directory itself and delegate new chat to the host", async () => {
  const list = spyOn(client, "listProjectThreads").mockResolvedValue([])
  const open = spyOn(opener, "openPath").mockResolvedValue()
  let created = 0
  try {
    const view = render(
      <ProjectSessionPopover
        cwd="/tmp/project"
        onSelect={() => {}}
        onNewChat={() => {
          created++
        }}
      />
    )
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "project" }))
    })
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Open project folder" }))
    })
    expect(open).toHaveBeenCalledWith("/tmp/project")
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull())
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "project" }))
    })
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "New chat" }))
    })
    expect(created).toBe(1)
  } finally {
    list.mockRestore()
    open.mockRestore()
  }
})

test("a late response for a previous project cannot replace the current project's list", async () => {
  let finish!: (threads: ThreadSummary[]) => void
  const list = spyOn(client, "listProjectThreads")
    .mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve
        })
    )
    .mockResolvedValue([{ ...must(threads("/tmp/other")[0]), title: "Other project" }])
  try {
    const view = render(<ProjectSessionPopover cwd="/tmp/project" onSelect={() => {}} onNewChat={() => {}} />)
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "project" }))
    })
    await act(async () => {
      view.rerender(<ProjectSessionPopover cwd="/tmp/other" onSelect={() => {}} onNewChat={() => {}} />)
    })
    expect(view.getByText("1 chat")).toBeDefined()
    await act(async () => {
      finish(threads())
    })
    expect(view.getByText("1 chat")).toBeDefined()
    expect(view.getByRole("button", { name: "Other project" })).toBeDefined()
    expect(view.queryByRole("button", { name: "Chat 0" })).toBeNull()
  } finally {
    list.mockRestore()
  }
})
