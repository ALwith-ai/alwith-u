import { afterAll, beforeEach, expect, spyOn, test } from "bun:test"
import * as opener from "@tauri-apps/plugin-opener"
import { act, fireEvent, render, waitFor } from "@testing-library/react"
import type { ThreadSummary } from "@/agent/client"
import { NavigationGroup } from "@/features/layout/components/navigation/navigation-group"
import { ThreadInfoCard } from "@/features/threads/thread-info-card"
import { must } from "@/lib/__tests__/must"
import { client } from "@/lib/client"
import { initI18n } from "@/lib/i18n"
import { installDom } from "../codex/__tests__/dom-environment"
import * as projectApps from "../open-in-editor"
import { ProjectSessionPopover } from "../project-session-popover"

installDom()
await initI18n("en")
const connect = spyOn(client, "connect").mockResolvedValue()
const apps = spyOn(projectApps, "useProjectApps").mockImplementation(cwd => ({
  apps: [],
  active: undefined,
  openWith: () => {},
  refresh: () => {},
  openPreferred: () => opener.openPath(must(cwd, "project directory"))
}))
// Restore this shared singleton before subsequent test files run.
afterAll(() => {
  connect.mockRestore()
  apps.mockRestore()
})
beforeEach(() => client.store.setState({ threads: [], archivedThreads: [] }))

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
    expect(list).toHaveBeenCalledTimes(1)
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

test("sidebar hover shares the header cache while clicking still toggles the project", async () => {
  const list = spyOn(client, "listProjectThreads").mockResolvedValue(threads())
  const toggles: boolean[] = []
  try {
    const header = render(<ProjectSessionPopover cwd="/tmp/project" onSelect={() => {}} onNewChat={() => {}} />)
    await act(async () => {
      fireEvent.click(header.getByRole("button", { name: "project" }))
    })
    expect(header.getByText("7 chats")).toBeDefined()
    header.unmount()
    const sidebar = render(
      <NavigationGroup
        open={false}
        onOpenChange={value => toggles.push(value)}
        label="Project group"
        wrapHeader={trigger => (
          <ProjectSessionPopover cwd="/tmp/project" trigger={trigger} onSelect={() => {}} onNewChat={() => {}} />
        )}>
        <span>Children</span>
      </NavigationGroup>
    )
    await act(async () => {
      fireEvent.click(sidebar.getByRole("button", { name: "Project group" }))
    })
    expect(toggles).toEqual([true])
    expect(sidebar.queryByRole("dialog")).toBeNull()
    const trigger = must(sidebar.container.querySelector<HTMLElement>('[data-slot="popover-trigger"]'))
    await act(async () => {
      fireEvent.pointerEnter(trigger, { pointerType: "mouse" })
      fireEvent.mouseEnter(trigger)
      fireEvent.mouseMove(trigger)
    })
    await waitFor(() => expect(sidebar.getByRole("button", { name: "Chat 6" })).toBeDefined())
    expect(list).toHaveBeenCalledTimes(1)
    expect(sidebar.queryByText("7 chats")).toBeNull()
    await act(async () => {
      fireEvent.click(sidebar.getByRole("button", { name: "Show more" }))
    })
    expect(sidebar.getAllByRole("button", { name: /^Chat / })).toHaveLength(7)
  } finally {
    list.mockRestore()
  }
})

test("a changed project list invalidates its closed popup before reopening", async () => {
  const list = spyOn(client, "listProjectThreads").mockResolvedValue(threads())
  try {
    const view = render(<ProjectSessionPopover cwd="/tmp/project" onSelect={() => {}} onNewChat={() => {}} />)
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "project" }))
    })
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "project" }))
    })
    await act(async () => {
      client.store.setState({ threads: [{ ...must(threads()[0]), title: "Renamed" }] })
    })
    list.mockResolvedValue([{ ...must(threads()[0]), title: "Renamed" }])
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "project" }))
    })
    expect(view.getByRole("button", { name: "Renamed" })).toBeDefined()
    expect(list).toHaveBeenCalledTimes(2)
  } finally {
    list.mockRestore()
  }
})

test("session-card title and path scroll only on hover and the path opens its own cwd", async () => {
  const open = spyOn(opener, "openPath").mockResolvedValue()
  try {
    const thread = { ...must(threads()[0]), title: "A long session title", cwd: "/tmp/a/long/project/path" }
    const view = render(<ThreadInfoCard thread={thread} />)
    for (const text of [thread.title, thread.cwd]) {
      const content = view.getByText(text)
      Object.defineProperties(content, { scrollWidth: { value: 360 }, clientWidth: { value: 100 } })
      const viewport = must(content.parentElement)
      expect(content.style.transform).toBe("translateX(0px)")
      fireEvent.mouseEnter(viewport)
      expect(content.style.transform).toBe("translateX(-260px)")
      fireEvent.mouseLeave(viewport)
      expect(content.style.transform).toBe("translateX(0px)")
    }
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Open project folder" }))
    })
    expect(open).toHaveBeenCalledWith(thread.cwd)
  } finally {
    open.mockRestore()
  }
})
