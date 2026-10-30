import { SessionTimeline } from "@alwith/module-chat/session-timeline"
import type { Session, ToolItem } from "@nyssance/codex-acp-v2/client"
import { createSession, isDiffEntry } from "@nyssance/codex-acp-v2/client"
import { invoke } from "@tauri-apps/api/core"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import { ThemeProvider } from "@/components/theme-provider"
import { client } from "@/lib/client"
import { initI18n } from "@/lib/i18n"

import { useChatHost, useTimelineSlots } from "../chat-host"
import { navigationSoundStore } from "../codex/navigation-sound-store"
import { ChatDirectoryContext } from "../file-actions"
import { filePatches, updateUndone } from "../undo"
import { UndoActions } from "../undo-actions"

vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke: vi.fn()
}))
beforeEach(() => vi.clearAllMocks())
navigationSoundStore.setState({ soundMode: "none" })
await initI18n("en")
const original = client.state
let sequence = 0
function item(id: string, path = "/project/a"): ToolItem {
  return {
    kind: "tool",
    id,
    at: 1,
    endedAt: 2,
    replayed: false,
    _meta: null,
    name: "apply_patch",
    title: "Edit",
    toolKind: "edit",
    status: "completed",
    locations: [],
    rawInput: null,
    rawOutput: null,
    content: [
      {
        type: "diff",
        changes: [{ operation: "modify", path }],
        patch: {
          format: "git_patch",
          text: "--- a\n+++ a\n@@ -1 +1 @@\n-old\n+new\n"
        }
      }
    ]
  }
}
function mount(items: ToolItem[]) {
  const id = `undo-test-${++sequence}`
  client.store.setState({
    sessions: {
      ...client.state.sessions,
      [id]: { ...createSession(id, "/project"), attached: true }
    }
  })
  return { id, view: render(<UndoActions sessionId={id} items={items} />) }
}
afterEach(() => {
  cleanup()
  client.store.setState(original, true)
  vi.restoreAllMocks()
})

test("collects repeated edits in order and refuses incomplete or failed change data", () => {
  const items = [item("a"), item("b")]
  expect(filePatches(items)).toHaveLength(2)
  expect(() => filePatches([{ ...items[0]!, status: "failed" }])).toThrow()
  const missing = item("missing")
  const entry = missing.content[0]!
  if (isDiffEntry(entry)) delete entry.patch
  expect(() => filePatches([missing])).toThrow()
  expect(() => filePatches([])).toThrow()
  expect(updateUndone([], [1, 4], { applied: [1], failed: { index: 0, message: "conflict" } }, true)).toEqual([
    undefined,
    undefined,
    undefined,
    undefined,
    true
  ])
})

test("undo and reapply use the originating session, survive remounts and block repeated clicks", async () => {
  let complete!: (result: unknown) => void
  vi.mocked(invoke).mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve
      }) as ReturnType<typeof invoke>
  )
  const items = [item("single")]
  const { id, view } = mount(items)
  fireEvent.click(screen.getByRole("button", { name: "Undo" }))
  expect(screen.getByRole("button", { name: "Working…" })).toBeDisabled()
  fireEvent.click(screen.getByRole("button", { name: "Working…" }))
  expect(invoke).toHaveBeenCalledTimes(1)
  expect(invoke).toHaveBeenCalledWith(
    "workspace_apply_patches",
    expect.objectContaining({ root: "/project", reverse: true })
  )
  view.unmount()
  await act(async () => complete({ applied: [0], failed: null }))
  render(<UndoActions sessionId={id} items={items} />)
  expect(screen.queryByRole("button", { name: "Undo" })).toBeNull()
  fireEvent.click(screen.getByRole("button", { name: "Reapply" }))
  expect(invoke).toHaveBeenLastCalledWith("workspace_apply_patches", expect.objectContaining({ reverse: false }))
  await act(async () => complete({ applied: [0], failed: null }))
  expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled()
})

test("partial failure retries only remaining patches and can reapply the successful subset", async () => {
  vi.mocked(invoke).mockResolvedValue({
    applied: [1],
    failed: { index: 0, message: "user edit conflicts" }
  })
  mount([item("first"), item("second", "/project/b")])
  fireEvent.click(screen.getByRole("button", { name: "Undo" }))
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("user edit conflicts"))
  expect(screen.getByRole("button", { name: "Reapply" })).toBeEnabled()
  vi.mocked(invoke).mockResolvedValue({ applied: [0], failed: null })
  fireEvent.click(screen.getByRole("button", { name: "Undo" }))
  await waitFor(() => expect(screen.queryByRole("button", { name: "Undo" })).toBeNull())
  const args = vi.mocked(invoke).mock.calls.at(-1)?.[1] as {
    patches: unknown[]
  }
  expect(args.patches).toHaveLength(1)
})

test("running or read-only sessions and missing patches disable mutation", () => {
  const { id } = mount([item("blocked")])
  act(() =>
    client.store.setState({
      sessions: {
        ...client.state.sessions,
        [id]: { ...client.state.sessions[id]!, state: "running" }
      }
    })
  )
  expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled()
  act(() =>
    client.store.setState({
      sessions: {
        ...client.state.sessions,
        [id]: { ...client.state.sessions[id]!, state: "idle", readOnly: true }
      }
    })
  )
  expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled()
})

test("reapply after partial undo touches only confirmed reverted batches", async () => {
  vi.mocked(invoke).mockResolvedValue({
    applied: [1],
    failed: { index: 0, message: "conflict" }
  })
  mount([item("partial-a"), item("partial-b", "/project/b")])
  fireEvent.click(screen.getByRole("button", { name: "Undo" }))
  await waitFor(() => expect(screen.getByRole("button", { name: "Reapply" })).toBeEnabled())
  vi.mocked(invoke).mockResolvedValue({ applied: [0], failed: null })
  fireEvent.click(screen.getByRole("button", { name: "Reapply" }))
  await waitFor(() => expect(screen.queryByRole("button", { name: "Reapply" })).toBeNull())
  const args = vi.mocked(invoke).mock.calls.at(-1)?.[1] as {
    patches: { newPath: string }[]
    reverse: boolean
  }
  expect(args.reverse).toBe(false)
  expect(args.patches.map((patch) => patch.newPath)).toEqual(["/project/b"])
})

test("transport failures keep the previous action state and allow retry", async () => {
  vi.mocked(invoke).mockRejectedValue(new Error("Git is unavailable"))
  mount([item("transport")])
  fireEvent.click(screen.getByRole("button", { name: "Undo" }))
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Git is unavailable"))
  expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled()
  expect(screen.queryByRole("button", { name: "Reapply" })).toBeNull()
})

test("rejects mutation when the session disappears and keeps other cards independent", async () => {
  vi.mocked(invoke).mockResolvedValue({ applied: [0], failed: null })
  const { id } = mount([item("session-one")])
  const other = mount([item("session-two")])
  act(() => {
    const sessions = { ...client.state.sessions }
    delete sessions[id]
    client.store.setState({ sessions })
  })
  const buttons = screen.getAllByRole("button", { name: "Undo" })
  expect(buttons[0]).toBeDisabled()
  expect(buttons[1]).toBeEnabled()
  fireEvent.click(buttons[1]!)
  await waitFor(() => expect(screen.getByRole("button", { name: "Reapply" })).toBeEnabled())
  expect(client.state.sessions[other.id]).toBeDefined()
})

test("the completed turn's real edited-files card mounts Undo through the shared timeline", async () => {
  const id = `undo-stream-${++sequence}`
  const session: Session = {
    ...createSession(id, "/project"),
    attached: true,
    items: [
      {
        kind: "user" as const,
        id: "user",
        at: 1,
        replayed: false,
        echo: null,
        _meta: null,
        content: [{ type: "text" as const, text: "Edit the file" }]
      },
      item("stream-edit"),
      {
        kind: "assistant" as const,
        echo: null,
        id: "answer",
        at: 3,
        replayed: false,
        _meta: null,
        content: [{ type: "text" as const, text: "Done" }]
      }
    ]
  }
  client.store.setState({ sessions: { ...client.state.sessions, [id]: session } })
  function Stream() {
    const host = useChatHost(session.id)
    const slots = useTimelineSlots()
    return <SessionTimeline {...slots} host={host} client={client} session={session} />
  }
  render(
    <ThemeProvider>
      <ChatDirectoryContext value={session.cwd}>
        <Stream />
      </ChatDirectoryContext>
    </ThemeProvider>
  )
  expect(await screen.findByRole("button", { name: "Undo" })).toBeEnabled()
})
