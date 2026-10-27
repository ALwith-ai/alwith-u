import { NavigationGroup, SessionInfoCard } from "@alwith/module-chat/session-list"
import * as opener from "@tauri-apps/plugin-opener"
import { act, fireEvent, render, waitFor } from "@testing-library/react"
import { afterAll, beforeEach, expect, test, vi } from "vitest"

import type { SessionSummary } from "@/agent/client"
import { commands } from "@/bindings"
import * as collectionStore from "@/features/collection/store"
import { SessionListHostProvider } from "@/features/sessions/session-list-host"
import { must } from "@/lib/__tests__/must"
import { client } from "@/lib/client"
import { initI18n } from "@/lib/i18n"

import * as projectApps from "../open-in-editor"
import { ProjectSessionPopover } from "../project-session-popover"

// Package exports are frozen ESM namespaces; mock the module so the export can be spied on.
vi.mock("@tauri-apps/plugin-opener", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  openPath: vi.fn()
}))

await initI18n("en")
const connect = vi.spyOn(client, "connect").mockResolvedValue()
const directory = vi.spyOn(commands, "draftDirectory").mockResolvedValue("/Users/mac/Documents/ALwith")
const apps = vi.spyOn(projectApps, "useProjectApps").mockImplementation((cwd) => ({
  apps: [],
  active: undefined,
  openWith: () => {},
  refresh: () => {},
  openPreferred: () => opener.openPath(must(cwd, "project directory"))
}))
// Restore this shared singleton before subsequent test files run.
afterAll(() => {
  connect.mockRestore()
  directory.mockRestore()
  apps.mockRestore()
})
beforeEach(() =>
  client.store.setState({ sessionList: [], archivedSessions: [], sessionListLoaded: true, sessionListError: null })
)

function sessionRows(cwd = "/tmp/project"): SessionSummary[] {
  return Array.from({ length: 7 }, (_, index) => ({
    sessionId: `chat-${index}`,
    cwd,
    title: `Chat ${index}`,
    updatedAt: `2026-09-0${index + 1}T00:00:00Z`,
    archived: false
  }))
}

test("project popover shows the full count, expands beyond five chats and routes the selected session", async () => {
  const entries = sessionRows()
  client.store.setState({ sessionList: entries })
  const list = vi.spyOn(client, "listSessions")
  const selected: SessionSummary[] = []
  try {
    const view = render(
      <ProjectSessionPopover
        cwd="/tmp/project"
        onSelect={(sessionRow) => selected.push(sessionRow)}
        onNewChat={() => {}}
      />
    )
    expect(list).not.toHaveBeenCalled()
    await act(() => {
      return Promise.try(() => {
        fireEvent.click(view.getByRole("button", { name: "project" }))
      })
    })
    expect(list).not.toHaveBeenCalled()
    expect(view.getByText("7 chats")).toBeDefined()
    expect(view.getAllByRole("button", { name: /^Chat / })).toHaveLength(5)
    expect(view.getAllByRole("button", { name: /^Chat / })[0]?.textContent).toContain("Chat 6")
    await act(() => {
      return Promise.try(() => {
        fireEvent.click(view.getByRole("button", { name: "Show more" }))
      })
    })
    expect(view.getAllByRole("button", { name: /^Chat / })).toHaveLength(7)
    expect(view.getAllByRole("button", { name: /collection|favorite/i })).toHaveLength(7)
    await act(() => {
      return Promise.try(() => {
        fireEvent.click(view.getByRole("button", { name: "Chat 0" }))
      })
    })
    expect(selected[0]?.sessionId).toBe("chat-0")
    expect(selected[0]?.cwd).toBe("/tmp/project")
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull())
  } finally {
    list.mockRestore()
  }
})

test("loading and failure expose shared list state, and retry refreshes the shared cache", async () => {
  client.store.setState({ connection: "ready", sessionListLoaded: false, sessionListLoading: true })
  const list = vi.spyOn(client, "listSessions").mockResolvedValue()
  try {
    const view = render(<ProjectSessionPopover cwd="/tmp/project" onSelect={() => {}} onNewChat={() => {}} />)
    await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "project" }))))
    expect(view.getByRole("status").textContent).toContain("Loading chats")
    expect(view.queryByText(/\d+ chats?/)).toBeNull()
    await act(() =>
      Promise.try(() => client.store.setState({ sessionListLoading: false, sessionListError: "Unavailable" }))
    )
    expect(view.getByRole("alert").textContent).toBe("Unavailable")
    list.mockImplementation(() => {
      return Promise.try(() => {
        client.store.setState({ sessionListLoaded: true, sessionListError: null })
      })
    })
    await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "Retry" }))))
    expect(list).toHaveBeenLastCalledWith({ reset: true })
    expect(view.getByText("0 chats")).toBeDefined()
  } finally {
    list.mockRestore()
  }
})

test("project actions open the directory itself and delegate new chat to the host", async () => {
  const list = vi.spyOn(client, "listSessions")
  const open = vi.spyOn(opener, "openPath").mockResolvedValue()
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
    await act(() => {
      return Promise.try(() => {
        fireEvent.click(view.getByRole("button", { name: "project" }))
      })
    })
    await act(() => {
      return Promise.try(() => {
        fireEvent.click(view.getByRole("button", { name: "Open project folder" }))
      })
    })
    expect(open).toHaveBeenCalledWith("/tmp/project")
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull())
    await act(() => {
      return Promise.try(() => {
        fireEvent.click(view.getByRole("button", { name: "project" }))
      })
    })
    await act(() => {
      return Promise.try(() => {
        fireEvent.click(view.getByRole("button", { name: "New chat" }))
      })
    })
    expect(created).toBe(1)
    expect(list).not.toHaveBeenCalled()
  } finally {
    list.mockRestore()
    open.mockRestore()
  }
})

test("changing projects selects from the latest shared snapshot", async () => {
  const view = render(<ProjectSessionPopover cwd="/tmp/project" onSelect={() => {}} onNewChat={() => {}} />)
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "project" }))))
  await act(() =>
    Promise.try(() =>
      view.rerender(<ProjectSessionPopover cwd="/tmp/other" onSelect={() => {}} onNewChat={() => {}} />)
    )
  )
  await act(() =>
    Promise.try(() =>
      client.store.setState({
        sessionList: [
          ...sessionRows(),
          {
            ...must(sessionRows("/tmp/other")[0], "a session in the other project"),
            sessionId: "other",
            title: "Other project"
          }
        ]
      })
    )
  )
  expect(view.getByText("1 chat")).toBeDefined()
  expect(view.getByRole("button", { name: "Other project" })).toBeDefined()
  expect(view.queryByRole("button", { name: "Chat 0" })).toBeNull()
})

test("sidebar hover shares the header cache while clicking still toggles the project", async () => {
  client.store.setState({ sessionList: sessionRows() })
  const list = vi.spyOn(client, "listSessions")
  const toggles: boolean[] = []
  try {
    const header = render(<ProjectSessionPopover cwd="/tmp/project" onSelect={() => {}} onNewChat={() => {}} />)
    await act(() => {
      return Promise.try(() => {
        fireEvent.click(header.getByRole("button", { name: "project" }))
      })
    })
    expect(header.getByText("7 chats")).toBeDefined()
    header.unmount()
    const sidebar = render(
      <NavigationGroup
        open={false}
        onOpenChange={(value) => toggles.push(value)}
        label="Project group"
        wrapHeader={(trigger) => (
          <ProjectSessionPopover cwd="/tmp/project" trigger={trigger} onSelect={() => {}} onNewChat={() => {}} />
        )}
      >
        <span>Children</span>
      </NavigationGroup>
    )
    await act(() => {
      return Promise.try(() => {
        fireEvent.click(sidebar.getByRole("button", { name: "Project group" }))
      })
    })
    expect(toggles).toEqual([true])
    expect(sidebar.queryByRole("dialog")).toBeNull()
    const trigger = must(
      sidebar.container.querySelector<HTMLElement>('[data-slot="popover-trigger"]'),
      "the popover trigger"
    )
    await act(() => {
      return Promise.try(() => {
        fireEvent.pointerEnter(trigger, { pointerType: "mouse" })
        fireEvent.mouseEnter(trigger)
        fireEvent.mouseMove(trigger)
      })
    })
    await waitFor(() => expect(sidebar.getByRole("button", { name: "Chat 6" })).toBeDefined())
    expect(list).not.toHaveBeenCalled()
    expect(sidebar.queryByText("7 chats")).toBeNull()
    await act(() => {
      return Promise.try(() => {
        fireEvent.click(sidebar.getByRole("button", { name: "Show more" }))
      })
    })
    expect(sidebar.getAllByRole("button", { name: /^Chat / })).toHaveLength(7)
  } finally {
    list.mockRestore()
  }
})

test("a changed project list invalidates its closed popup before reopening", async () => {
  client.store.setState({ sessionList: sessionRows() })
  const list = vi.spyOn(client, "listSessions")
  try {
    const view = render(<ProjectSessionPopover cwd="/tmp/project" onSelect={() => {}} onNewChat={() => {}} />)
    await act(() => {
      return Promise.try(() => {
        fireEvent.click(view.getByRole("button", { name: "project" }))
      })
    })
    await act(() => {
      return Promise.try(() => {
        fireEvent.click(view.getByRole("button", { name: "project" }))
      })
    })
    await act(() => {
      return Promise.try(() => {
        client.store.setState({ sessionList: [{ ...must(sessionRows()[0], "the first session"), title: "Renamed" }] })
      })
    })
    await act(() => {
      return Promise.try(() => {
        fireEvent.click(view.getByRole("button", { name: "project" }))
      })
    })
    expect(view.getByRole("button", { name: "Renamed" })).toBeDefined()
    expect(list).not.toHaveBeenCalled()
  } finally {
    list.mockRestore()
  }
})

test("session-card title and path scroll only on hover and the path opens its own cwd", async () => {
  const open = vi.spyOn(opener, "openPath").mockResolvedValue()
  try {
    const sessionRow = {
      ...must(sessionRows()[0], "the first session"),
      title: "A long session title",
      cwd: "/tmp/a/long/project/path"
    }
    const view = render(
      <SessionListHostProvider>
        <SessionInfoCard sessionRow={sessionRow} />
      </SessionListHostProvider>
    )
    for (const text of [sessionRow.title, sessionRow.cwd]) {
      const content = view.getByText(text)
      Object.defineProperties(content, { scrollWidth: { value: 360 }, clientWidth: { value: 100 } })
      const viewport = must(content.parentElement, "the scroll viewport")
      expect(content.style.transform).toBe("translateX(0px)")
      fireEvent.mouseEnter(viewport)
      expect(content.style.transform).toBe("translateX(-260px)")
      fireEvent.mouseLeave(viewport)
      expect(content.style.transform).toBe("translateX(0px)")
    }
    await act(() => {
      return Promise.try(() => {
        fireEvent.click(view.getByRole("button", { name: "Open project folder" }))
      })
    })
    expect(open).toHaveBeenCalledWith(sessionRow.cwd)
  } finally {
    open.mockRestore()
  }
})

test("project path aliases share the popover cache and still show every matching chat", async () => {
  const key = vi.spyOn(client, "projectPath").mockImplementation((cwd) => cwd.replace(/^\/var\//, "/private/var/"))
  client.store.setState({ sessionList: sessionRows("/private/var/deleted-project") })
  const list = vi.spyOn(client, "listSessions")
  try {
    const first = render(<ProjectSessionPopover cwd="/var/deleted-project" onSelect={() => {}} onNewChat={() => {}} />)
    await act(() => {
      return Promise.try(() => {
        fireEvent.click(first.getByRole("button", { name: "deleted-project" }))
      })
    })
    expect(first.getByText("7 chats")).toBeDefined()
    first.unmount()
    const second = render(
      <ProjectSessionPopover cwd="/private/var/deleted-project" onSelect={() => {}} onNewChat={() => {}} />
    )
    await act(() => {
      return Promise.try(() => {
        fireEvent.click(second.getByRole("button", { name: "deleted-project" }))
      })
    })
    expect(second.getByText("7 chats")).toBeDefined()
    expect(list).not.toHaveBeenCalled()
    await act(() => {
      return Promise.try(() => {
        fireEvent.click(second.getByRole("button", { name: "Show more" }))
      })
    })
    expect(second.getAllByRole("button", { name: /^Chat / })).toHaveLength(7)
  } finally {
    key.mockRestore()
    list.mockRestore()
  }
})

test.each(["/Users/mac/Documents/Codex", "/Users/mac/Documents/ALwith"])(
  "quick-chat directory %s exposes the shared quick-chat popover",
  async (cwd) => {
    client.store.setState({ sessionList: sessionRows("/Users/mac/Documents/Codex/nested") })
    const view = render(<ProjectSessionPopover cwd={cwd} onSelect={() => {}} onNewChat={() => {}} />)
    await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "Quick chats" }))))
    expect(view.getByText("7 chats")).toBeVisible()
    expect(view.getByText("/Users/mac/Documents/ALwith")).toBeVisible()
  }
)

test.each([
  "/private/var/folders/example/T/project",
  "/var/folders/example/T/project",
  String.raw`C:\Users\Alice\AppData\Local\Temp\project`,
  String.raw`C:\Windows\Temp\project`,
  String.raw`D:\Scratch\project`
])("temporary directory %s exposes its project chats", async (cwd) => {
  client.store.setState({ sessionList: sessionRows(cwd) })
  const view = render(<ProjectSessionPopover cwd={cwd} onSelect={() => {}} onNewChat={() => {}} />)
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "project" }))))
  expect(view.getByText("7 chats")).toBeDefined()
})

test("the Drive action has an explicit label and opens existing project sessions", async () => {
  const entries = sessionRows()
  client.store.setState({ sessionList: entries })
  const selected = vi.fn()
  const newChat = vi.fn()
  const view = render(
    <ProjectSessionPopover actionLabel="Recent sessions" cwd="/tmp/project" onSelect={selected} onNewChat={newChat} />
  )
  await act(() => {
    fireEvent.click(view.getByRole("button", { name: "Recent sessions" }))

    return Promise.resolve()
  })
  await waitFor(() => expect(view.getByText("Chat 6")).toBeTruthy())
  fireEvent.click(view.getByText("Chat 6"))
  expect(selected).toHaveBeenCalledWith(entries[6])
  expect(newChat).not.toHaveBeenCalled()
})

test("the project quick favorite targets its row without selecting the conversation", async () => {
  client.store.setState({ sessionList: sessionRows() })
  const selected = vi.fn()
  const dispatch = vi.spyOn(collectionStore, "dispatchCollection").mockResolvedValue()
  try {
    const view = render(<ProjectSessionPopover cwd="/tmp/project" onSelect={selected} onNewChat={() => {}} />)
    await act(() => Promise.resolve(fireEvent.click(view.getByRole("button", { name: "project" }))))
    const row = must(view.getByRole("button", { name: "Chat 6" }).parentElement, "project session row")
    const favorite = must(row.querySelector<HTMLButtonElement>("button[aria-haspopup=menu]"), "quick favorite")
    await act(() => Promise.resolve(fireEvent.click(favorite)))
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: "favorite", sessionId: "chat-6" })
    expect(selected).not.toHaveBeenCalled()
    expect(view.getByRole("dialog")).toBeVisible()
  } finally {
    dispatch.mockRestore()
  }
})
