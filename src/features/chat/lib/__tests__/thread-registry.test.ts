import { afterEach, expect, test } from "bun:test"
import { clearThread, publishThread, revealThreadTurn, threadRegistry } from "../thread-registry"

afterEach(() => {
  const id = threadRegistry.getState().sessionId
  if (id !== null) clearThread(id)
})

test("search releases following before mounting and aligning the target turn", async () => {
  const calls: string[] = []
  publishThread({ sessionId: "one", turns: [], beforeReveal: () => { calls.push("release") },
    api: { scrollToKey: async (key, target, options) => {
      expect(target).toBeUndefined()
      expect(options).toEqual({ align: "top" })
      calls.push(key)
    } } })
  await revealThreadTurn("one", "turn-one", new AbortController().signal)
  expect(calls).toEqual(["release", "turn-one"])
})

test("aborted and stale-session searches cannot move the newly selected chat", async () => {
  const calls: string[] = []
  publishThread({ sessionId: "two", turns: [], beforeReveal: () => { calls.push("release") },
    api: { scrollToKey: async () => { calls.push("scroll") } } })
  await revealThreadTurn("one", "old-turn", new AbortController().signal)
  const controller = new AbortController()
  controller.abort()
  await revealThreadTurn("two", "new-turn", controller.signal)
  expect(calls).toEqual([])
  clearThread("one")
  expect(threadRegistry.getState().sessionId).toBe("two")
  clearThread("two")
  expect(threadRegistry.getState().beforeReveal).toBeNull()
  await revealThreadTurn("two", "new-turn", new AbortController().signal)
  expect(calls).toEqual([])
})
