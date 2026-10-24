import { Effect } from "effect"
import { expect, test, vi } from "vitest"

import { openWorkspaceScope, workspaceTask } from "../workspace-lifecycle"

function gate<A>() {
  let resolve!: (value: A) => void
  const promise = new Promise<A>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

test("normal disposal releases resources in reverse order exactly once", async () => {
  const calls: string[] = []
  const abort = new AbortController()
  const workspace = await openWorkspaceScope(
    abort.signal,
    Effect.gen(function* () {
      for (const name of ["editor", "tree", "watch", "subscription"]) {
        yield* Effect.acquireRelease(Effect.succeed(name), (name) =>
          Effect.sync(() => {
            calls.push(name)
          })
        )
      }
      return {}
    }),
    vi.fn()
  )
  expect(calls).toEqual([])
  const first = workspace.dispose()
  expect(workspace.dispose()).toBe(first)
  await first
  abort.abort()
  expect(calls).toEqual(["subscription", "watch", "tree", "editor"])
})

test("initialization failure retains its identity and releases already acquired resources", async () => {
  const stop = vi.fn()
  const error = new Error("tree initialization failed")
  const build = Effect.gen(function* () {
    yield* Effect.acquireRelease(Effect.void, () => Effect.sync(stop))
    return yield* Effect.fail(error)
  })
  await expect(openWorkspaceScope(new AbortController().signal, build, vi.fn())).rejects.toBe(error)
  expect(stop).toHaveBeenCalledOnce()
})

test("abort during acquisition waits for and releases the late watch", async () => {
  const abort = new AbortController()
  const entered = gate<void>()
  const acquired = gate<() => void>()
  const stop = vi.fn()
  let finished = false
  const result = openWorkspaceScope(
    abort.signal,
    Effect.gen(function* () {
      yield* Effect.acquireRelease(
        workspaceTask(() => {
          entered.resolve()
          return acquired.promise
        }),
        (stop) => Effect.sync(stop)
      )
      return {}
    }),
    vi.fn()
  ).catch((error: unknown) => {
    finished = true
    return error
  })
  await entered.promise
  abort.abort()
  await Promise.resolve()
  expect(finished).toBe(false)
  acquired.resolve(stop)
  expect(await result).toBe(abort.signal.reason)
  expect(stop).toHaveBeenCalledOnce()
})

test("cleanup failure does not skip other resources or hide initialization failure", async () => {
  const original = new Error("initialization failed")
  const cleanup = new Error("watch cleanup failed")
  const releaseEditor = vi.fn()
  const build = Effect.gen(function* () {
    yield* Effect.acquireRelease(Effect.void, () => Effect.sync(releaseEditor))
    yield* Effect.acquireRelease(Effect.void, () => Effect.die(cleanup))
    return yield* Effect.fail(original)
  })
  await expect(openWorkspaceScope(new AbortController().signal, build, vi.fn())).rejects.toMatchObject({
    errors: [original, cleanup]
  })
  expect(releaseEditor).toHaveBeenCalledOnce()
})

test("abort closes a live scope and explicit disposal joins asynchronous cleanup", async () => {
  const abort = new AbortController()
  const release = gate<void>()
  const started = gate<void>()
  const report = vi.fn()
  const workspace = await openWorkspaceScope(
    abort.signal,
    Effect.gen(function* () {
      yield* Effect.addFinalizer(() =>
        workspaceTask(() => {
          started.resolve()
          return release.promise
        }).pipe(Effect.orDie)
      )
      return {}
    }),
    report
  )
  abort.abort()
  await started.promise
  let closed = false
  const closing = workspace.dispose().then(() => {
    closed = true
  })
  await Promise.resolve()
  expect(closed).toBe(false)
  release.resolve()
  await closing
  expect(report).not.toHaveBeenCalled()
})

test("an already aborted lifetime never acquires resources", async () => {
  const abort = new AbortController()
  abort.abort()
  const create = vi.fn(() => ({}))
  await expect(openWorkspaceScope(abort.signal, Effect.sync(create), vi.fn())).rejects.toBe(abort.signal.reason)
  expect(create).not.toHaveBeenCalled()
})
