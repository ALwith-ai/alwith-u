import type { SessionRunState } from "@alwith/api"
import { act, cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

import type { ThreadSummary } from "@/agent/client"
import { useChatWindowSurface } from "@/lib/chat-window-state"
import { client } from "@/lib/client"
import { initI18n } from "@/lib/i18n"
import { isMac } from "@/lib/platform"

import { ActivityPanel } from "../activity-panel"
import { useThreadsUiStore } from "../store"

await initI18n("en")
vi.mock("@/lib/platform", () => ({ isMac: vi.fn(() => false) }))
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}), openPath: vi.fn(async () => {}) }))
vi.mock("@/lib/chat-window", () => ({ focusChatSession: vi.fn(async () => {}) }))
const { focusChatSession } = await import("@/lib/chat-window")
const { openUrl } = await import("@tauri-apps/plugin-opener")
const originalState = client.state
const originalUi = useThreadsUiStore.getState()
afterEach(async () => {
  await act(async () => {
    cleanup()
    client.store.setState(originalState, true)
    useThreadsUiStore.setState(originalUi, true)
    useChatWindowSurface.setState({ sessionId: null, visible: false })
    vi.clearAllMocks()
    vi.mocked(isMac).mockReturnValue(false)
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

test("deleted and reconnected unsent drafts never become activity navigation targets", async () => {
  client.store.setState({ threads: [], draftSessions: { deleted: "main" } })
  client.applyRunStates([
    record("deleted", true),
    record("reconnected", true),
    record("conversation", false, "running")
  ])
  const selected: string[] = []
  const view = render(<ActivityPanel selectedId={null} onSelect={(thread) => selected.push(thread.sessionId)} />)
  expect(view.queryByText("deleted")).not.toBeInTheDocument()
  // Deletion drops local ownership; Runtime may still broadcast the unsent draft.
  await act(async () => client.store.setState({ draftSessions: {} }))
  await act(async () =>
    client.applyRunStates([
      record("deleted", true),
      record("reconnected", true),
      record("conversation", false, "running")
    ])
  )
  expect(view.queryByText("deleted")).not.toBeInTheDocument()
  expect(view.queryByText("reconnected")).not.toBeInTheDocument()
  await act(async () => fireEvent.keyDown(window, { key: "1", ctrlKey: true }))
  expect(selected).toEqual(["conversation"])
  await act(async () => fireEvent.click(view.getByText("conversation")))
  expect(selected).toEqual(["conversation", "conversation"])
})

test("first send appears only after local ownership and Runtime draft state have both transitioned", async () => {
  client.store.setState({ threads: [], draftSessions: { draft: "main" } })
  client.applyRunStates([record("draft", true)])
  const view = render(<ActivityPanel selectedId="draft" onSelect={() => {}} />)
  await act(async () => client.store.setState({ draftSessions: {} }))
  expect(view.queryByText("draft")).not.toBeInTheDocument()
  await act(async () => client.applyRunStates([record("draft", false, "running")]))
  expect(view.getByText("draft")).toBeInTheDocument()
  await act(async () => client.applyRunStates([record("draft", false, "done")]))
  expect(view.getByText("draft")).toBeInTheDocument()
  expect(client.state.runStates.draft?.state).toBe("done")
})

test("conversations remain navigable in every Runtime state without a sidebar history entry", async () => {
  client.store.setState({ threads: [], draftSessions: {} })
  client.applyRunStates([
    record("running", false, "running"),
    record("approval", false, "requires_action"),
    record("done", false, "done"),
    record("idle", false)
  ])
  const selected: ThreadSummary[] = []
  const view = render(<ActivityPanel selectedId={null} onSelect={(thread) => selected.push(thread)} />)
  for (const id of ["running", "approval", "done", "idle"]) await act(async () => fireEvent.click(view.getByText(id)))
  expect(selected.map((thread) => thread.sessionId)).toEqual(["running", "approval", "done", "idle"])
  expect(selected.every((thread) => thread.cwd === "/tmp")).toBe(true)
})

function rowIds(container: HTMLElement): (string | null)[] {
  return [...container.querySelectorAll("[data-session-id]")].map((row) => row.getAttribute("data-session-id"))
}

test("activity order survives updated timestamps, reversed snapshots and panel remounts", async () => {
  client.applyRunStates([record("first", false), record("second", false)])
  const view = render(<ActivityPanel selectedId={null} onSelect={() => {}} />)
  expect(rowIds(view.container)).toEqual(["first", "second"])
  await act(async () => {
    client.store.setState({
      threads: [
        { sessionId: "first", title: "first", cwd: "/tmp", updatedAt: "2026-10-12T12:00:00Z", archived: false },
        { sessionId: "second", title: "second", cwd: "/tmp", updatedAt: "2026-10-12T10:00:00Z", archived: false }
      ]
    })
    client.applyRunStates([record("second", false), record("first", false, "running")])
  })
  expect(rowIds(view.container)).toEqual(["first", "second"])
  view.unmount()
  client.applyRunStates([record("third", false), record("second", false), record("first", false)])
  const remounted = render(<ActivityPanel selectedId={null} onSelect={() => {}} />)
  expect(rowIds(remounted.container)).toEqual(["first", "second", "third"])
  await act(async () => client.applyRunStates([record("second", false), record("third", false)]))
  await act(async () =>
    client.applyRunStates([record("first", false), record("third", false), record("second", false)])
  )
  expect(rowIds(remounted.container)).toEqual(["second", "third", "first"])
})

test("Ctrl hints and shortcuts follow visible rows and ignore collapsed groups", async () => {
  client.applyRunStates([record("background", false), record("foreground", false)])
  const selected: string[] = []
  const view = render(<ActivityPanel selectedId="foreground" onSelect={(thread) => selected.push(thread.sessionId)} />)
  await act(async () => fireEvent.keyDown(window, { key: "Control", ctrlKey: true }))
  expect(view.getByText("Ctrl+1")).toBeInTheDocument()
  await act(async () => fireEvent.keyDown(window, { key: "2", ctrlKey: true }))
  expect(selected).toEqual(["background"])
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Background" })))
  await act(async () => fireEvent.keyDown(window, { key: "2", ctrlKey: true }))
  expect(selected).toEqual(["background"])
  await act(async () => fireEvent.keyDown(window, { key: "1", ctrlKey: true }))
  expect(selected).toEqual(["background", "foreground"])
  await act(async () => fireEvent.blur(window))
  expect(view.queryByText("Ctrl+1")).not.toBeInTheDocument()
})

test("listening ports open externally without selecting the session", async () => {
  client.applyRunStates([{ ...record("server", false), listeningPorts: [3000, 5173] }])
  const selected: string[] = []
  const view = render(<ActivityPanel selectedId={null} onSelect={(thread) => selected.push(thread.sessionId)} />)
  await act(async () => fireEvent.click(view.getByRole("button", { name: ":5173" })))
  expect(openUrl).toHaveBeenCalledExactlyOnceWith("http://localhost:5173")
  expect(selected).toEqual([])
})

test("visible chat-window sessions join the foreground and clicks focus their existing window", async () => {
  client.applyRunStates([record("background", false), record("chat-window", false), record("main", false)])
  client.store.setState({ sessionWindows: { "chat-window": "chat" } })
  useChatWindowSurface.setState({ sessionId: "chat-window", visible: true })
  const selected: string[] = []
  const view = render(<ActivityPanel selectedId="main" onSelect={(thread) => selected.push(thread.sessionId)} />)
  expect(rowIds(view.container)).toEqual(["chat-window", "main", "background"])
  expect(view.getByLabelText("Floating window")).toBeInTheDocument()
  await act(async () => fireEvent.click(view.getByText("chat-window")))
  expect(focusChatSession).toHaveBeenCalledExactlyOnceWith("chat-window")
  expect(selected).toEqual([])
  await act(async () => useChatWindowSurface.setState({ visible: false }))
  expect(rowIds(view.container)).toEqual(["main", "background", "chat-window"])
  // Hidden windows still own their conversation; opening reveals them instead of migrating it.
  await act(async () => fireEvent.keyDown(window, { key: "3", ctrlKey: true }))
  expect(focusChatSession).toHaveBeenCalledTimes(2)
  expect(selected).toEqual([])
})

test.each([true, false])("primary-modifier navigation respects platform and active dialogs (mac=%s)", async (mac) => {
  vi.mocked(isMac).mockReturnValue(mac)
  client.applyRunStates([record("target", false)])
  const selected: string[] = []
  const view = render(<ActivityPanel selectedId={null} onSelect={(thread) => selected.push(thread.sessionId)} />)
  const modifier = mac ? { metaKey: true } : { ctrlKey: true }
  await act(async () => fireEvent.keyDown(window, { key: "1", ...(mac ? { ctrlKey: true } : { metaKey: true }) }))
  expect(selected).toEqual([])
  await act(async () => fireEvent.keyDown(window, { key: mac ? "Meta" : "Control", ...modifier }))
  expect(view.getByText(mac ? "⌘1" : "Ctrl+1")).toBeInTheDocument()
  await act(async () => fireEvent.keyDown(window, { key: "1", ...modifier }))
  expect(selected).toEqual(["target"])
  const dialog = render(<div role="dialog" aria-label="Test dialog" />)
  await act(async () => fireEvent.keyDown(window, { key: "1", ...modifier }))
  expect(selected).toEqual(["target"])
  dialog.unmount()
  await act(async () => fireEvent.keyUp(window, { key: mac ? "Meta" : "Control" }))
  expect(view.queryByText(mac ? "⌘1" : "Ctrl+1")).not.toBeInTheDocument()
})

test("background conversations retain their floating host across selection changes", async () => {
  client.applyRunStates([record("first", false), record("second", false)])
  client.store.setState({ sessionWindows: { first: "chat", second: "chat" } })
  useChatWindowSurface.setState({ sessionId: "second", visible: true })
  const selected = vi.fn()
  const view = render(<ActivityPanel selectedId={null} onSelect={selected} />)
  expect(rowIds(view.container)).toEqual(["second", "first"])
  expect(view.getAllByLabelText("Floating window")).toHaveLength(2)
  await act(async () => fireEvent.click(view.getByText("first")))
  expect(focusChatSession).toHaveBeenCalledExactlyOnceWith("first")
  expect(selected).not.toHaveBeenCalled()
  await act(async () => client.store.setState({ sessionWindows: { first: "main", second: "chat" } }))
  expect(view.getAllByLabelText("Floating window")).toHaveLength(1)
  await act(async () => fireEvent.click(view.getByText("first")))
  expect(selected).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "first" }))
})

test("the state dot carries Runtime's interruption as its title", async () => {
  client.store.setState({ threads: [], draftSessions: {} })
  client.applyRunStates([{ ...record("paused", false, "requires_action"), interruption: "runtime restarted" }])
  const view = render(<ActivityPanel selectedId={null} onSelect={() => {}} />)
  expect(view.getByTitle("runtime restarted")).toBeInTheDocument()
})
