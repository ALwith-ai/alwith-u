import { commands } from "@alwith/module-computer/commands"
import { Cause, Effect, Exit, Semaphore } from "effect"

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
    Exit.isFailure(exit) ? attempt(() => commands.stop()).pipe(Effect.orDie) : Effect.void
  )
  yield* attempt(() => updateSettings({ "computer.enabled": true }))
}, Effect.scoped)

/** Application authority changes execution admission without refreshing conversations. */
export function enableComputer(): Promise<void> {
  return transition(enable(() => commands.start()))
}

/** Closing the shared driver revokes native execution without closing MCP discovery or chat. */
export function stopComputer(): Promise<void> {
  return transition(
    Effect.gen(function* () {
      yield* attempt(() => commands.stop())
      yield* attempt(() => updateSettings({ "computer.enabled": false }))
    })
  )
}

/** Restore computer access only when the user explicitly enabled it. */
export function restoreComputer(): Promise<void> {
  return transition(
    Effect.gen(function* () {
      if (settingsStore.get<boolean>("computer.enabled") !== true) return
      const status = yield* attempt(() => commands.status())
      if (status.enabled || !status.available || !status.permissions.supported) return
      if (!status.permissions.accessibility || !status.permissions.screenCapture) return
      // Failed verification needs an explicit reconnect, not another automatic polling attempt.
      if (status.phase !== "disabled") return
      yield* attempt(() => commands.start())
    })
  )
}

/** Reconnect replaces only the Driver generation without replaying any previous action. */
export function reconnectComputer(): Promise<void> {
  return transition(enable(() => commands.reconnect()))
}
