import type { SessionRunState } from "@alwith/api"
import { afterEach, expect, test, vi } from "vitest"
import { CodexClient } from "../client"
import { watchThreadList } from "../thread-list-refresh"
import { createFakeAgent } from "./fake-agent"
import { FakeHubPort } from "./fake-runtime-client"

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const stop of cleanups.splice(0)) stop()
  vi.useRealTimers()
})

async function make() {
  const fake = createFakeAgent()
  const port = new FakeHubPort(() => fake.app)
  const client = new CodexClient(async () => port, { agentId: "codex", launch: { engine: "codex" } })
  await client.connect()
  cleanups.push(() => client.disconnect())
  return client
}

function record(state: SessionRunState["state"]): SessionRunState {
  return {
    sessionId: "one",
    state,
    cwd: "/project",
    title: "One",
    reusableDraft: false,
    owner: "stdio",
    since: 0,
    lastActivityAt: 0,
    tasks: [],
    listeningPorts: [],
    executionId: null,
    executionRole: null
  }
}

test("startup refreshes once; state bursts coalesce and task updates do not refetch", async () => {
  const client = await make()
  const list = vi.spyOn(client, "listThreads").mockResolvedValue()
  vi.useFakeTimers()
  cleanups.push(watchThreadList(client))
  await vi.advanceTimersByTimeAsync(0)
  expect(list).toHaveBeenCalledTimes(1)
  client.applyRunStates([record("running")])
  client.applyRunStates([record("requires_action")])
  client.applyRunStates([record("done")])
  await vi.advanceTimersByTimeAsync(299)
  expect(list).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(list).toHaveBeenCalledTimes(2)
  client.applyRunStates([{ ...record("done"), lastActivityAt: 100, listeningPorts: [3000] }])
  await vi.advanceTimersByTimeAsync(500)
  expect(list).toHaveBeenCalledTimes(2)
})

test("changes during a fetch schedule one trailing refresh; disposal cancels scheduled work", async () => {
  const client = await make()
  let finish!: () => void
  const list = vi
    .spyOn(client, "listThreads")
    .mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve
        })
    )
    .mockResolvedValue()
  vi.useFakeTimers()
  const stop = watchThreadList(client)
  cleanups.push(stop)
  client.applyRunStates([record("running")])
  await vi.advanceTimersByTimeAsync(500)
  expect(list).toHaveBeenCalledTimes(1)
  finish()
  await vi.advanceTimersByTimeAsync(300)
  expect(list).toHaveBeenCalledTimes(2)
  client.applyRunStates([record("done")])
  stop()
  await vi.advanceTimersByTimeAsync(500)
  expect(list).toHaveBeenCalledTimes(2)
})
