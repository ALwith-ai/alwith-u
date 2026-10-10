import type { SessionRunState } from "@alwith/api"
import { act, cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, expect, test } from "vitest"
import type { ThreadSummary } from "@/agent/client"
import { client } from "@/lib/client"
import { initI18n } from "@/lib/i18n"
import { ActivityPanel } from "../activity-panel"

await initI18n("en")
const originalState = client.state
afterEach(async () => {
  await act(async () => {
    cleanup()
    client.store.setState(originalState, true)
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
  const view = render(<ActivityPanel selectedId={null} onSelect={thread => selected.push(thread.sessionId)} />)
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
  await act(async () => fireEvent.keyDown(window, { key: "1", metaKey: true }))
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
  const view = render(<ActivityPanel selectedId={null} onSelect={thread => selected.push(thread)} />)
  for (const id of ["running", "approval", "done", "idle"]) await act(async () => fireEvent.click(view.getByText(id)))
  expect(selected.map(thread => thread.sessionId)).toEqual(["running", "approval", "done", "idle"])
  expect(selected.every(thread => thread.cwd === "/tmp")).toBe(true)
})
