import { type SessionRunState } from "@alwith/api"
import { createSession, type MessageItem } from "@nyssance/codex-acp-v2/client"
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

import type { SessionSummary } from "@/agent/client"
import { useChatWindowSurface } from "@/lib/chat-window-state"
import { client } from "@/lib/client"
import { initI18n } from "@/lib/i18n"
import { isMac } from "@/lib/platform"

import { ActivityPanel } from "../activity-panel"
import { SessionListHostProvider } from "../session-list-host"
import { useSessionsUiStore } from "../store"

await initI18n("en")
vi.mock("@/lib/platform", () => ({ isMac: vi.fn(() => false) }))
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}), openPath: vi.fn(async () => {}) }))
vi.mock("@/lib/chat-window", () => ({ focusChatSession: vi.fn(async () => {}) }))
const { focusChatSession } = await import("@/lib/chat-window")
const { openUrl } = await import("@tauri-apps/plugin-opener")
const originalState = client.state
const originalUi = useSessionsUiStore.getState()
afterEach(async () => {
  await act(() => {
    return Promise.try(() => {
      cleanup()
      client.store.setState(originalState, true)
      useSessionsUiStore.setState(originalUi, true)
      useChatWindowSurface.setState({ sessionId: null, visible: false })
      vi.restoreAllMocks()
      vi.mocked(isMac).mockReturnValue(false)
    })
  })
})

function record(sessionId: string, reusableDraft: boolean, state: SessionRunState["state"] = "idle"): SessionRunState {
  return {
    sessionId,
    reusableDraft,
    state,
    cwd: "/tmp",
    title: sessionId,
    owner: "stdio",
    since: 0,
    lastActivityAt: 0,
    version: 1,
    interruption: null,
    tasks: [],
    listeningPorts: [],
    executionId: null,
    executionRole: null
  }
}

test("owned unsent drafts appear as activity navigation targets", async () => {
  client.store.setState({ sessionList: [], draftSessions: { deleted: "main" } })
  client.applyRunStates([
    record("deleted", true),
    record("reconnected", true),
    record("conversation", false, "running")
  ])
  const selected: string[] = []
  const view = render(
    <ActivityPanel selectedId={null} onSelect={(sessionRow) => selected.push(sessionRow.sessionId)} />,
    { wrapper: SessionListHostProvider }
  )
  expect(view.getByText("deleted")).toBeInTheDocument()
  // Deletion drops local ownership; Runtime may still broadcast the unsent draft.
  await act(() => Promise.try(() => client.store.setState({ draftSessions: {} })))
  await act(() =>
    Promise.try(() =>
      client.applyRunStates([
        record("deleted", true),
        record("reconnected", true),
        record("conversation", false, "running")
      ])
    )
  )
  expect(view.queryByText("deleted")).not.toBeInTheDocument()
  expect(view.queryByText("reconnected")).not.toBeInTheDocument()
  await act(() => Promise.try(() => fireEvent.keyDown(window, { key: "1", ctrlKey: true })))
  expect(selected).toEqual(["conversation"])
  await act(() => Promise.try(() => fireEvent.click(view.getByText("conversation"))))
  expect(selected).toEqual(["conversation", "conversation"])
})

test("first send appears only after local ownership and Runtime draft state have both transitioned", async () => {
  client.store.setState({ sessionList: [], draftSessions: { draft: "main" } })
  client.applyRunStates([record("draft", true)])
  const view = render(<ActivityPanel selectedId="draft" onSelect={() => {}} />, { wrapper: SessionListHostProvider })
  await act(() => Promise.try(() => client.store.setState({ draftSessions: {} })))
  expect(view.queryByText("draft")).not.toBeInTheDocument()
  await act(() => Promise.try(() => client.applyRunStates([record("draft", false, "running")])))
  expect(view.getByText("draft")).toBeInTheDocument()
  await act(() => Promise.try(() => client.applyRunStates([record("draft", false, "done")])))
  expect(view.getByText("draft")).toBeInTheDocument()
  expect(client.state.runStates.draft?.state).toBe("done")
})

test("conversations remain navigable in every Runtime state without a sidebar history entry", async () => {
  client.store.setState({ sessionList: [], draftSessions: {} })
  client.applyRunStates([
    record("running", false, "running"),
    record("approval", false, "requires_action"),
    record("done", false, "done"),
    record("idle", false)
  ])
  const selected: SessionSummary[] = []
  const view = render(<ActivityPanel selectedId={null} onSelect={(sessionRow) => selected.push(sessionRow)} />, {
    wrapper: SessionListHostProvider
  })
  for (const id of ["running", "approval", "done", "idle"])
    await act(() => Promise.try(() => fireEvent.click(view.getByText(id))))
  expect(selected.map((sessionRow) => sessionRow.sessionId)).toEqual(["running", "approval", "done", "idle"])
  expect(selected.every((sessionRow) => sessionRow.cwd === "/tmp")).toBe(true)
})

function rowIds(container: HTMLElement): (string | null)[] {
  return [...container.querySelectorAll("[data-session-id]")].map((row) => row.getAttribute("data-session-id"))
}

test("activity order survives updated timestamps, reversed snapshots and panel remounts", async () => {
  client.applyRunStates([record("first", false), record("second", false)])
  const view = render(<ActivityPanel selectedId={null} onSelect={() => {}} />, { wrapper: SessionListHostProvider })
  expect(rowIds(view.container)).toEqual(["first", "second"])
  await act(() => {
    return Promise.try(() => {
      client.store.setState({
        sessionList: [
          { sessionId: "first", title: "first", cwd: "/tmp", updatedAt: "2026-10-12T12:00:00Z", archived: false },
          { sessionId: "second", title: "second", cwd: "/tmp", updatedAt: "2026-10-12T10:00:00Z", archived: false }
        ]
      })
      client.applyRunStates([record("second", false), record("first", false, "running")])
    })
  })
  expect(rowIds(view.container)).toEqual(["first", "second"])
  view.unmount()
  client.applyRunStates([record("third", false), record("second", false), record("first", false)])
  const remounted = render(<ActivityPanel selectedId={null} onSelect={() => {}} />, {
    wrapper: SessionListHostProvider
  })
  expect(rowIds(remounted.container)).toEqual(["first", "second", "third"])
  await act(() => Promise.try(() => client.applyRunStates([record("second", false), record("third", false)])))
  await act(() =>
    Promise.try(() => client.applyRunStates([record("first", false), record("third", false), record("second", false)]))
  )
  expect(rowIds(remounted.container)).toEqual(["second", "third", "first"])
})

test("Ctrl hints and shortcuts follow visible rows and ignore collapsed groups", async () => {
  client.applyRunStates([record("background", false), record("foreground", false)])
  const selected: string[] = []
  const view = render(
    <ActivityPanel selectedId="foreground" onSelect={(sessionRow) => selected.push(sessionRow.sessionId)} />,
    { wrapper: SessionListHostProvider }
  )
  await act(() => Promise.try(() => fireEvent.keyDown(window, { key: "Control", ctrlKey: true })))
  expect(view.getByText("Ctrl+1")).toBeInTheDocument()
  await act(() => Promise.try(() => fireEvent.keyDown(window, { key: "2", ctrlKey: true })))
  expect(selected).toEqual(["background"])
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "Background" }))))
  await act(() => Promise.try(() => fireEvent.keyDown(window, { key: "2", ctrlKey: true })))
  expect(selected).toEqual(["background"])
  await act(() => Promise.try(() => fireEvent.keyDown(window, { key: "1", ctrlKey: true })))
  expect(selected).toEqual(["background", "foreground"])
  await act(() => Promise.try(() => fireEvent.blur(window)))
  expect(view.queryByText("Ctrl+1")).not.toBeInTheDocument()
})

test("shared ports follow Runtime's session assignment and open without selecting a session", async () => {
  client.applyRunStates([{ ...record("first", false), listeningPorts: [50945] }, record("second", false)])
  const select = vi.fn()
  const view = render(<ActivityPanel selectedId={null} onSelect={select} />, { wrapper: SessionListHostProvider })
  const port = view.getByRole("button", { name: ":50945" })
  expect(port.closest("[data-session-id]")).toHaveAttribute("data-session-id", "first")
  await act(() => Promise.try(() => fireEvent.click(port)))
  expect(openUrl).toHaveBeenCalledExactlyOnceWith("http://localhost:50945")
  expect(select).not.toHaveBeenCalled()
  await act(() =>
    Promise.try(() =>
      client.applyRunStates([record("first", false), { ...record("second", false), listeningPorts: [50945] }])
    )
  )
  expect(view.getAllByRole("button", { name: ":50945" })).toHaveLength(1)
  expect(view.getByRole("button", { name: ":50945" }).closest("[data-session-id]")).toHaveAttribute(
    "data-session-id",
    "second"
  )
})

test("unopened activities fetch replies without selecting or reading either session", async () => {
  client.store.setState({ connection: "ready", sessions: {} })
  client.applyRunStates([record("first", false, "done"), record("second", false)])
  const replies = vi.spyOn(client, "activityReply").mockImplementation((id) => Promise.resolve(`Reply for ${id}`))
  const select = vi.fn()
  const view = render(<ActivityPanel selectedId={null} onSelect={select} />, { wrapper: SessionListHostProvider })
  await waitFor(() => expect(view.getByText("Reply for first")).toBeInTheDocument())
  expect(view.getByText("Reply for second")).toBeInTheDocument()
  expect(replies).toHaveBeenCalledWith("first")
  expect(replies).toHaveBeenCalledWith("second")
  expect(select).not.toHaveBeenCalled()
  expect(client.state.sessions).toEqual({})
  expect(client.state.runStates.first?.state).toBe("done")
  const row = view.getByText("Reply for first").closest("[data-session-id]")
  expect(row).toHaveClass("items-center")
  expect(row).not.toHaveClass("items-start")
})

test("visible chat-window sessions join the foreground and clicks focus their existing window", async () => {
  client.applyRunStates([record("background", false), record("chat-window", false), record("main", false)])
  client.store.setState({ sessionWindows: { "chat-window": "chat" } })
  useChatWindowSurface.setState({ sessionId: "chat-window", visible: true })
  const selected: string[] = []
  const view = render(
    <ActivityPanel selectedId="main" onSelect={(sessionRow) => selected.push(sessionRow.sessionId)} />,
    { wrapper: SessionListHostProvider }
  )
  expect(rowIds(view.container)).toEqual(["chat-window", "main", "background"])
  expect(view.getByLabelText("Floating window")).toBeInTheDocument()
  await act(() => Promise.try(() => fireEvent.click(view.getByText("chat-window"))))
  expect(focusChatSession).toHaveBeenCalledExactlyOnceWith("chat-window")
  expect(selected).toEqual([])
  await act(() => Promise.try(() => useChatWindowSurface.setState({ visible: false })))
  expect(rowIds(view.container)).toEqual(["main", "background", "chat-window"])
  // Hidden windows still own their conversation; opening reveals them instead of migrating it.
  await act(() => Promise.try(() => fireEvent.keyDown(window, { key: "3", ctrlKey: true })))
  expect(focusChatSession).toHaveBeenCalledTimes(2)
  expect(selected).toEqual([])
})

test.each([true, false])("primary-modifier navigation respects platform and active dialogs (mac=%s)", async (mac) => {
  vi.mocked(isMac).mockReturnValue(mac)
  client.applyRunStates([record("target", false)])
  const selected: string[] = []
  const view = render(
    <ActivityPanel selectedId={null} onSelect={(sessionRow) => selected.push(sessionRow.sessionId)} />,
    { wrapper: SessionListHostProvider }
  )
  const modifier = mac ? { metaKey: true } : { ctrlKey: true }
  await act(() =>
    Promise.try(() => fireEvent.keyDown(window, { key: "1", ...(mac ? { ctrlKey: true } : { metaKey: true }) }))
  )
  expect(selected).toEqual([])
  await act(() => Promise.try(() => fireEvent.keyDown(window, { key: mac ? "Meta" : "Control", ...modifier })))
  expect(view.getByText(mac ? "⌘1" : "Ctrl+1")).toBeInTheDocument()
  await act(() => Promise.try(() => fireEvent.keyDown(window, { key: "1", ...modifier })))
  expect(selected).toEqual(["target"])
  const dialog = render(<div role="dialog" aria-label="Test dialog" />)
  await act(() => Promise.try(() => fireEvent.keyDown(window, { key: "1", ...modifier })))
  expect(selected).toEqual(["target"])
  dialog.unmount()
  await act(() => Promise.try(() => fireEvent.keyUp(window, { key: mac ? "Meta" : "Control" })))
  expect(view.queryByText(mac ? "⌘1" : "Ctrl+1")).not.toBeInTheDocument()
})

test("background conversations retain their floating host across selection changes", async () => {
  client.applyRunStates([record("first", false), record("second", false)])
  client.store.setState({ sessionWindows: { first: "chat", second: "chat" } })
  useChatWindowSurface.setState({ sessionId: "second", visible: true })
  const selected = vi.fn()
  const view = render(<ActivityPanel selectedId={null} onSelect={selected} />, { wrapper: SessionListHostProvider })
  expect(rowIds(view.container)).toEqual(["second", "first"])
  expect(view.getAllByLabelText("Floating window")).toHaveLength(2)
  await act(() => Promise.try(() => fireEvent.click(view.getByText("first"))))
  expect(focusChatSession).toHaveBeenCalledExactlyOnceWith("first")
  expect(selected).not.toHaveBeenCalled()
  await act(() => Promise.try(() => client.store.setState({ sessionWindows: { first: "main", second: "chat" } })))
  expect(view.getAllByLabelText("Floating window")).toHaveLength(1)
  await act(() => Promise.try(() => fireEvent.click(view.getByText("first"))))
  expect(selected).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "first" }))
})

test("the state dot carries Runtime's interruption as its title", () => {
  return Promise.try(() => {
    client.store.setState({ sessionList: [], draftSessions: {} })
    client.applyRunStates([{ ...record("paused", false, "requires_action"), interruption: "runtime restarted" }])
    const view = render(<ActivityPanel selectedId={null} onSelect={() => {}} />, { wrapper: SessionListHostProvider })
    expect(view.getByTitle("runtime restarted")).toBeInTheDocument()
  })
})

test("reply previews follow their own session's latest assistant upsert and preserve running tasks", async () => {
  const message = (id: string, kind: MessageItem["kind"], text: string): MessageItem => ({
    id,
    kind,
    content: [{ type: "text", text }],
    at: 0,
    replayed: false,
    _meta: null,
    echo: null
  })
  const first = {
    ...createSession("first", "/tmp"),
    items: [message("reply", "assistant", "First response"), message("user", "user", "New request")]
  }
  client.store.setState({
    sessions: {
      first,
      second: {
        ...createSession("second", "/tmp"),
        items: [message("reply", "assistant", "Second response"), message("thought", "thought", "Private reasoning")]
      }
    }
  })
  client.applyRunStates([
    {
      ...record("first", false, "running"),
      tasks: [{ id: "worker", title: "Checking results", background: true, since: 0 }]
    },
    record("second", false)
  ])
  const view = render(<ActivityPanel selectedId="first" onSelect={() => {}} />, { wrapper: SessionListHostProvider })
  expect(view.getByText("First response").closest("[data-session-id]")).toHaveAttribute("data-session-id", "first")
  expect(view.getByText("Second response").closest("[data-session-id]")).toHaveAttribute("data-session-id", "second")
  expect(view.queryByText("Private reasoning")).not.toBeInTheDocument()
  expect(view.queryByText("New request")).not.toBeInTheDocument()
  expect(view.getByText("Checking results")).toBeInTheDocument()
  await act(() =>
    Promise.try(() =>
      client.store.setState({
        sessions: {
          ...client.state.sessions,
          first: { ...first, items: [message("reply", "assistant", "Updated\nstreaming response")] }
        }
      })
    )
  )
  expect(view.queryByText("First response")).not.toBeInTheDocument()
  expect(view.getByText("Updated streaming response")).toHaveClass("line-clamp-2")
  expect(view.getByText("Second response")).toBeInTheDocument()
})

test("an unread completion renders a blue dot until Runtime confirms it was read", async () => {
  client.applyRunStates([record("unread", false, "done")])
  const view = render(<ActivityPanel selectedId={null} onSelect={() => {}} />, { wrapper: SessionListHostProvider })
  const row = () => view.container.querySelector('[data-session-id="unread"]')!
  expect(row().querySelector(".bg-blue-500")).not.toBeNull()
  expect(row().querySelector(".bg-green-500")).toBeNull()
  await act(() => Promise.try(() => client.applyRunStates([record("unread", false, "idle")])))
  expect(row().querySelector(".bg-blue-500")).toBeNull()
  expect(row().querySelector(".bg-green-500")).not.toBeNull()
})
