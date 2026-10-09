import { expect, test } from "vitest"
import { createInstallCoordinator } from "../install-coordinator"

test("concurrent wakeups drain each durable job once and return activation failures", async () => {
  const jobs = [{ requestId: "first" }, { requestId: "second" }]
  const started: string[] = []
  const finished: string[] = []
  let release: (() => void) | undefined
  const barrier = new Promise<void>(resolve => {
    release = resolve
  })
  const coordinator = createInstallCoordinator({
    next: async () => jobs.shift() ?? null,
    execute: async job => {
      started.push(job.requestId)
      if (job.requestId === "first") await barrier
      else throw new Error("hash mismatch")
      return { installed: true }
    },
    complete: async (id, result, error) => {
      finished.push(id)
      if (id === "first") expect(result).toEqual({ installed: true })
      else expect(error).toBe("hash mismatch")
    }
  })
  const first = coordinator.drain()
  const second = coordinator.drain()
  await new Promise<void>(resolve => setTimeout(resolve, 0))
  expect(started).toEqual(["first"])
  release?.()
  await Promise.all([first, second])
  expect(started).toEqual(["first", "second"])
  expect(finished).toEqual(["first", "second"])
})

test("completion persistence failure stays visible and a later wakeup can resume", async () => {
  let queued = true
  let executions = 0
  let attempts = 0
  let committed = false
  const coordinator = createInstallCoordinator({
    next: async () => {
      if (!queued) return null
      queued = false
      return { requestId: "job" }
    },
    execute: async () => {
      executions++
      return true
    },
    complete: async () => {
      if (attempts++ === 0) throw new Error("disk full")
      committed = true
    }
  })
  await expect(coordinator.drain()).rejects.toThrow("disk full")
  await coordinator.drain()
  expect(committed).toBe(true)
  expect(executions).toBe(1)
  expect(attempts).toBe(2)
})
