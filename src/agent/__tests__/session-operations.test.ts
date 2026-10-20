import { describe, expect, it } from "vitest"

import { SessionOperations } from "../session-operations"

function gate<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe("one ordered operation lane per session", () => {
  it("merges adjacent opens of one fingerprint, runs different fingerprints in order and keeps the last A of A→B→A", async () => {
    const operations = new SessionOperations()
    const runs: string[] = []
    const first = gate<string>()
    const a1 = operations.open("s", "A", () => {
      runs.push("A")
      return first.promise
    })
    const a2 = operations.open("s", "A", async () => {
      runs.push("A-again")
      return "unused"
    })
    expect(a2).toBe(a1)
    const b = operations.open("s", "B", async () => {
      runs.push("B")
      return "b"
    })
    const a3 = operations.open("s", "A", async () => {
      runs.push("A-last")
      return "a-last"
    })
    expect(operations.pending("s")).toBe(2)
    first.resolve("a")
    expect(await a1).toBe("a")
    expect(await b).toBe("b")
    expect(await a3).toBe("a-last")
    expect(runs).toEqual(["A", "B", "A-last"])
  })

  it("close while A restores and B is queued drops B; an open after the close runs once the close is done", async () => {
    const operations = new SessionOperations()
    const runs: string[] = []
    const opening = gate<string>()
    const a = operations.open("s", "A", () => {
      runs.push("open A")
      return opening.promise
    })
    const b = operations.open("s", "B", async () => {
      runs.push("open B")
      return "b"
    })
    const closing = gate<void>()
    const close = operations.close("s", () => {
      runs.push("close")
      return closing.promise
    })
    await expect(b).rejects.toMatchObject({ name: "AbortError" })
    const reopened = operations.open("s", "A", async () => {
      runs.push("open after close")
      return "again"
    })
    expect(runs).toEqual(["open A"])
    opening.resolve("a")
    expect(await a).toBe("a")
    await Promise.resolve()
    expect(runs).toEqual(["open A", "close"])
    closing.resolve()
    await close
    expect(await reopened).toBe("again")
    expect(runs).toEqual(["open A", "close", "open after close"])
  })

  it("a failed operation does not block the lane", async () => {
    const operations = new SessionOperations()
    const failed = operations.open("s", "A", async () => {
      throw new Error("boom")
    })
    const next = operations.open("s", "B", async () => "ok")
    await expect(failed).rejects.toThrow("boom")
    expect(await next).toBe("ok")
  })
})
