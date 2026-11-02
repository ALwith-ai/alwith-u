import type { SessionRunState } from "@alwith/api"
import { CodexClient } from "@alwith/module-chat/client"
import { sessionNavigationStore } from "@alwith/module-chat/session-list"
import { expect, test } from "vitest"

function record(sessionId: string, reusableDraft = false): SessionRunState {
  return {
    sessionId,
    reusableDraft,
    state: "running",
    cwd: "/tmp",
    title: sessionId,
    owner: "stdio",
    since: 1,
    lastActivityAt: 1,
    version: 1,
    interruption: null,
    tasks: [],
    listeningPorts: [],
    executionId: null,
    executionRole: null
  }
}

test("shared Activity ignores startup snapshots while retaining locally owned drafts", () => {
  const client = new CodexClient(() => Promise.reject(new Error("No Runtime in this test")), {
    agentId: "codex",
    launch: { engine: "mock" }
  })
  client.store.setState({ runStates: { historical: record("historical") } })
  const navigation = sessionNavigationStore(client)
  expect(navigation.get().activityOrder).toEqual([])
  client.store.setState({ runStates: { restored: record("restored") } })
  expect(navigation.get().activityOrder).toEqual([])
  client.store.setState({ drafts: { owned: true }, runStates: { owned: record("owned", true) } })
  expect(navigation.get().activityOrder).toEqual(["owned"])
  client.store.setState({ drafts: {} })
  expect(navigation.get().activityOrder).toEqual([])
})
