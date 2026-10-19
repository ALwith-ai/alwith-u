import { createSession, type Session } from "@alwith/api"
import { expect, test } from "vitest"
import { observeVoiceTurn } from "../voice-turn"
function fixture() {
  let session: Session = { ...createSession("s", "/tmp"), attached: true }
  const listeners = new Set<() => void>()
  return {
    source: {
      read: () => session,
      subscribe: (check: () => void) => {
        listeners.add(check)
        return () => {
          listeners.delete(check)
        }
      }
    },
    update(patch: Partial<Session>): void {
      session = { ...session, ...patch }
      for (const check of listeners) check()
    },
    listeners
  }
}
const user = {
  id: "receipt",
  kind: "user" as const,
  at: 1,
  replayed: false,
  _meta: null,
  content: [],
  echo: "acknowledged" as const
}
test("fast completion before receipt remains observable", async () => {
  const f = fixture()
  const observation = observeVoiceTurn(f.source, new AbortController().signal)
  f.update({ items: [user], turnEndedAt: { receipt: 2 }, lastStopReason: "end_turn" })
  observation.accept("receipt")
  await observation.completed
  expect(f.listeners.size).toBe(0)
})
test("an old error cannot reject a new receipt arriving before running", async () => {
  const f = fixture()
  f.update({ error: { stopReason: "error", error: null, meta: null } })
  const observation = observeVoiceTurn(f.source, new AbortController().signal)
  let settled = false
  void observation.completed.then(() => {
    settled = true
  })
  f.update({ items: [user] })
  observation.accept("receipt")
  await Promise.resolve()
  expect(settled).toBe(false)
  f.update({ state: "running", error: null })
  f.update({ state: "idle", turnEndedAt: { receipt: 3 }, lastStopReason: "end_turn" })
  await observation.completed
  expect(settled).toBe(true)
})
test("approval, cancellation and an intervening prompt end automatic listening", async () => {
  const f = fixture()
  const abort = new AbortController()
  const observation = observeVoiceTurn(f.source, abort.signal)
  f.update({ items: [user] })
  observation.accept("receipt")
  f.update({ state: "requires_action" })
  await expect(observation.completed).rejects.toThrow("voice_turn_interrupted")
  expect(f.listeners.size).toBe(0)
  f.update({ state: "idle" })
  const cancelled = observeVoiceTurn(f.source, abort.signal)
  abort.abort(new Error("cancelled"))
  await expect(cancelled.completed).rejects.toThrow("cancelled")
  const superseded = observeVoiceTurn(f.source, new AbortController().signal)
  superseded.accept("receipt")
  f.update({ items: [user, { ...user, id: "other" }] })
  await expect(superseded.completed).rejects.toThrow("voice_turn_superseded")
})
