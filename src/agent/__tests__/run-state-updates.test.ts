import type { SessionRunState } from "@alwith/api"
import { runStateSource } from "@alwith/module-chat/client"
import { expect, test, vi } from "vitest"

import { CodexClient } from "../client"

function fixture() {
  const client = new CodexClient(() => Promise.reject(new Error("No Runtime in this test")), {
    agentId: "codex",
    launch: { engine: "mock" }
  })
  const record: SessionRunState = {
    sessionId: "session",
    state: "running",
    reusableDraft: false,
    owner: "stdio",
    cwd: "/tmp",
    title: "Session",
    since: 1,
    lastActivityAt: 1,
    version: 1,
    interruption: null,
    tasks: [],
    listeningPorts: [],
    executionId: null,
    executionRole: null
  }
  return { client, record }
}

test("identical Runtime events preserve the store and do not notify consumers", () => {
  const { client, record } = fixture()
  client.applyRunStates([record])
  const before = client.state
  const changed = vi.fn()
  const stop = client.store.subscribe(changed)
  client.applyRunStates([structuredClone(record)])
  expect(client.state).toBe(before)
  expect(changed).not.toHaveBeenCalled()
  stop()
})

test("Runtime changes retain unchanged records and preserve completion versions and metadata", () => {
  const { client, record } = fixture()
  client.applyRunStates([record, { ...record, sessionId: "other" }])
  const unchanged = client.state.runStates.other
  client.applyRunStates([
    { ...record, state: "done", version: 2, lastActivityAt: 10, listeningPorts: [1430] },
    { ...record, sessionId: "other" }
  ])
  expect(client.state.runStates.other).toBe(unchanged)
  expect(client.state.runStates.session).toMatchObject({
    state: "done",
    version: 2,
    lastActivityAt: 10,
    listeningPorts: [1430]
  })
  client.applyRunStates([{ ...record, state: "idle", version: 3 }])
  expect(client.state.runStates.other).toBeUndefined()
  expect(client.state.runStates.session).toMatchObject({ state: "idle", version: 3 })
})

test("an event identical to the startup snapshot still changes its activity provenance", () => {
  const { client, record } = fixture()
  client.applyRunStates([record], "snapshot")
  expect(runStateSource(client.state.runStates)).toBe("snapshot")
  client.applyRunStates([structuredClone(record)])
  expect(runStateSource(client.state.runStates)).toBe("event")
})

test.each<Partial<SessionRunState>>([
  { lastActivityAt: 2 },
  { title: "Renamed session" },
  { listeningPorts: [1430] },
  { tasks: [{ id: "task", title: "Background task", background: true, since: 2 }] },
  { interruption: "Runtime disconnected" },
  { executionId: "execution", executionRole: "background" }
])("Runtime metadata changes are delivered without a state or version transition: %j", (change) => {
  const { client, record } = fixture()
  client.applyRunStates([record])
  const before = client.state
  client.applyRunStates([{ ...record, ...change }])
  expect(client.state).not.toBe(before)
  expect(client.state.runStates.session).toMatchObject({ ...change, state: "running", version: 1 })
})
