import type { SessionRunState } from "@alwith/api"
import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { createFakeAgent } from "@/agent/__tests__/fake-agent"
import { FakeHubPort } from "@/agent/__tests__/fake-runtime-client"
import * as clientModule from "../client"
import { useReadVisibleSession } from "../use-read-visible-session"

const originalState = clientModule.client.state
let runtime: FakeHubPort
let mark: ReturnType<typeof spyOn<typeof clientModule, "markRead">>
beforeEach(() => {
  runtime = new FakeHubPort(() => createFakeAgent().app)
  mark = vi.spyOn(clientModule, "markRead").mockImplementation(id => runtime.markRead(id))
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
    lastActivityAt: 0
  }
}

test("done arriving while the chat is offscreen is read only after returning to that chat", async () => {
  clientModule.client.applyRunStates([runState("selected", "running")])
  const view = renderHook(({ visible }) => useReadVisibleSession("selected", visible), {
    initialProps: { visible: false }
  })
  await act(async () => clientModule.client.applyRunStates([runState("selected", "done")]))
  expect(runtime.marked).toEqual([])
  expect(clientModule.client.state.runStates.selected?.state).toBe("done")
  await act(async () => view.rerender({ visible: true }))
  expect(runtime.marked).toEqual(["selected"])
})

test("drafts, running chats and action requests are never marked read; routing uses the explicit selected id", async () => {
  clientModule.client.applyRunStates([
    runState("first", "done"),
    runState("second", "done"),
    runState("running", "running"),
    runState("action", "requires_action")
  ])
  const view = renderHook(
    ({ sessionId, visible }: { sessionId: string | null; visible: boolean }) =>
      useReadVisibleSession(sessionId, visible),
    { initialProps: { sessionId: null, visible: true } }
  )
  await act(async () => view.rerender({ sessionId: "running", visible: true }))
  await act(async () => view.rerender({ sessionId: "action", visible: true }))
  await act(async () => view.rerender({ sessionId: "first", visible: false }))
  expect(runtime.marked).toEqual([])
  await act(async () => view.rerender({ sessionId: "second", visible: true }))
  expect(runtime.marked).toEqual(["second"])
})
