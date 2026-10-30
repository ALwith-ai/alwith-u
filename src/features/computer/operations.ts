import { Cause, Effect, Exit, Semaphore } from "effect"

import { commands } from "@/bindings"
import { settingsStore, updateSettings } from "@/lib/settings-store"

// Native owns application authority. This permit serializes this client's transitions and saves.
const transitions = Semaphore.makeUnsafe(1)

function attempt<A>(work: () => Promise<A>): Effect.Effect<A, unknown> {
  return Effect.tryPromise({ try: work, catch: (error) => error })
}

async function transition(work: Effect.Effect<unknown, unknown>): Promise<void> {
  const exit = await Effect.runPromiseExit(transitions.withPermit(work))
  if (Exit.isSuccess(exit)) return
  // Keep the public Promise rejection unchanged, including native error identity.
  const errors = exit.cause.reasons.flatMap((reason) => {
    if (Cause.isFailReason(reason)) return [reason.error]
    if (Cause.isDieReason(reason)) return [reason.defect]
    return []
  })
  if (errors.length === 1) throw errors[0]
  if (errors.length === 0) throw Cause.squash(exit.cause)
  throw new AggregateError(errors, "Computer access transition and rollback failed")
}

const enable = Effect.fn("Computer.enable")(function* (start: () => Promise<unknown>) {
  // Until the preference is saved, failure owns a rollback. Success leaves authority with native.
  yield* Effect.acquireRelease(attempt(start), (_, exit) =>
    Exit.isFailure(exit) ? attempt(() => commands.computerStop()).pipe(Effect.orDie) : Effect.void
  )
  yield* attempt(() => updateSettings({ "computer.enabled": true }))
}, Effect.scoped)

/** Native authority is application-wide; every session refreshes tools before its next prompt. */
export function enableComputer(): Promise<void> {
  return transition(enable(() => commands.computerStart()))
}

/** Closing the shared driver revokes every MCP connection without cancelling unrelated chat work. */
export function stopComputer(): Promise<void> {
  return transition(
    Effect.gen(function* () {
      yield* attempt(() => commands.computerStop())
      yield* attempt(() => updateSettings({ "computer.enabled": false }))
    })
  )
}

/** Restore a saved choice only when the OS still grants both required permissions. */
export function restoreComputer(): Promise<void> {
  return transition(
    Effect.gen(function* () {
      if (settingsStore.get<boolean>("computer.enabled") !== true) return
      const status = yield* attempt(() => commands.computerStatus())
      if (status.enabled || !status.available || !status.permissions.supported) return
      if (!status.permissions.accessibility || !status.permissions.screenCapture) return
      yield* attempt(() => commands.computerStart())
    })
  )
}

/** Reconnect replaces the driver generation without replaying any previous action. */
export function reconnectComputer(): Promise<void> {
  return transition(enable(() => commands.computerReconnect()))
}
