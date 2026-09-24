import { expect, mock, test } from "bun:test"
import type { ThreadSummary } from "@/agent/client"
import { ProjectThreadCache } from "../project-thread-cache"

const thread: ThreadSummary = {
  sessionId: "one",
  cwd: "/project",
  title: "Original",
  updatedAt: "2026-09-24",
  archived: false
}

test("project queries deduplicate while pending and reuse completed results", async () => {
  const query = mock(async () => [thread])
  const cache = new ProjectThreadCache(query)
  cache.load(thread.cwd)
  cache.load(thread.cwd)
  await Promise.resolve()
  cache.load(thread.cwd)
  expect(query).toHaveBeenCalledTimes(1)
  expect(cache.store.getState()[thread.cwd]).toEqual({ status: "ready", threads: [thread] })
})

test("mutations invalidate the affected project, keeping other project results", async () => {
  const query = mock(async (cwd: string) => [{ ...thread, cwd }])
  const cache = new ProjectThreadCache(query)
  cache.load(thread.cwd)
  cache.load("/other")
  await Promise.resolve()
  const mutations = [
    [[thread], [{ ...thread, title: "Renamed" }]],
    [[thread], []],
    [[], [thread]],
    [[thread], [{ ...thread, archived: true }]]
  ] satisfies [ThreadSummary[], ThreadSummary[]][]
  for (const [previous, current] of mutations) {
    cache.synchronize(previous, current)
    expect(cache.store.getState()[thread.cwd]).toBeUndefined()
    expect(cache.store.getState()["/other"]?.status).toBe("ready")
    cache.load(thread.cwd)
    await Promise.resolve()
  }
})

test("invalidated in-flight results cannot overwrite a newer project query", async () => {
  let finish!: (value: ThreadSummary[]) => void
  const query = mock(
    () =>
      new Promise<ThreadSummary[]>(resolve => {
        finish = resolve
      })
  )
  const cache = new ProjectThreadCache(query)
  cache.load(thread.cwd)
  const finishOld = finish
  cache.invalidate([thread.cwd])
  cache.load(thread.cwd)
  finish([{ ...thread, title: "New" }])
  await Promise.resolve()
  finishOld([thread])
  await Promise.resolve()
  expect(cache.store.getState()[thread.cwd]).toEqual({ status: "ready", threads: [{ ...thread, title: "New" }] })
})

test("failed queries expose the error and retry only after explicit invalidation", async () => {
  const query = mock(async () => {
    throw new Error("Query failed")
  })
  const cache = new ProjectThreadCache(query)
  cache.load(thread.cwd)
  await Promise.resolve()
  cache.load(thread.cwd)
  expect(query).toHaveBeenCalledTimes(1)
  expect(cache.store.getState()[thread.cwd]).toEqual({ status: "failed", error: "Query failed" })
  cache.invalidate([thread.cwd])
  cache.load(thread.cwd)
  await Promise.resolve()
  expect(query).toHaveBeenCalledTimes(2)
})
