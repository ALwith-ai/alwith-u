import type { SessionRunState } from "@alwith/api"
import { applyUpdate, createSession } from "@nyssance/codex-acp-v2/client"
import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, expect, type MockInstance, test, vi } from "vitest"

import { createFakeAgent } from "@/agent/__tests__/fake-agent"
import { FakeHubPort } from "@/agent/__tests__/fake-runtime-client"

import * as clientModule from "../client"
import { useReadVisibleSession } from "../use-read-visible-session"

const originalState = clientModule.client.state
let runtime: FakeHubPort
let mark: MockInstance<typeof clientModule.markRead>
type VisibleSession = { sessionId: string | null; visible: boolean }
beforeEach(() => {
  clientModule.client.store.setState({
    sessions: Object.fromEntries(
      ["selected", "first", "second", "running", "action"].map((id) => [
        id,
        {
          ...applyUpdate(createSession(id, "/tmp"), {
            sessionUpdate: "agent_message",
            messageId: "reply",
            content: [{ type: "text", text: "Visible response" }]
          }),
          attached: true
        }
      ])
    )
  })
  runtime = new FakeHubPort(() => createFakeAgent().app)
  mark = vi
    .spyOn(clientModule, "markRead")
    .mockImplementation((id) => runtime.markRead(id, clientModule.client.state.runStates[id]?.version ?? null))
})
afterEach(() => {
  cleanup()
  clientModule.client.store.setState(originalState, true)
  mark.mockRestore()
})

function runState(sessionId: string, state: SessionRunState["state"]): SessionRunState {
  return {
    sessionId,
    state,
    reusableDraft: false,
    owner: "",
    cwd: "/tmp",
    title: "",
    since: 0,
    tasks: [],
    listeningPorts: [],
    executionId: null,
    executionRole: null,
    lastActivityAt: 0,
    version: 1,
    interruption: null
  }
}

test("done arriving while the chat is offscreen is read only after returning to that chat", async () => {
  clientModule.client.applyRunStates([runState("selected", "running")])
  const view = renderHook(({ visible }) => useReadVisibleSession("selected", visible), {
    initialProps: { visible: false }
  })
  await act(() => Promise.try(() => clientModule.client.applyRunStates([runState("selected", "done")])))
  expect(runtime.marked).toEqual([])
  expect(clientModule.client.state.runStates.selected?.state).toBe("done")
  await act(() => Promise.try(() => view.rerender({ visible: true })))
  expect(runtime.marked).toEqual(["selected"])
})

test("drafts, running chats and action requests are never marked read; routing uses the explicit selected id", async () => {
  clientModule.client.applyRunStates([
    runState("first", "done"),
    runState("second", "done"),
    runState("running", "running"),
    runState("action", "requires_action")
  ])
  const initialProps: VisibleSession = { sessionId: null, visible: true }
  const view = renderHook(({ sessionId, visible }: VisibleSession) => useReadVisibleSession(sessionId, visible), {
    initialProps
  })
  await act(() => Promise.try(() => view.rerender({ sessionId: "running", visible: true })))
  await act(() => Promise.try(() => view.rerender({ sessionId: "action", visible: true })))
  await act(() => Promise.try(() => view.rerender({ sessionId: "first", visible: false })))
  expect(runtime.marked).toEqual([])
  await act(() => Promise.try(() => view.rerender({ sessionId: "second", visible: true })))
  expect(runtime.marked).toEqual(["second"])
})

test("an unread session stays unread while replaying and becomes readable only after its content is attached", async () => {
  const loaded = clientModule.client.state.sessions.selected!
  clientModule.client.store.setState({ sessions: { selected: { ...loaded, restoring: true, attached: false } } })
  clientModule.client.applyRunStates([runState("selected", "done")])
  renderHook(() => useReadVisibleSession("selected", true))
  expect(runtime.marked).toEqual([])
  expect(clientModule.client.state.runStates.selected?.state).toBe("done")
  await act(() =>
    Promise.try(() =>
      clientModule.client.store.setState({ sessions: { selected: { ...loaded, attached: true, restoring: false } } })
    )
  )
  expect(runtime.marked).toEqual(["selected"])
})
