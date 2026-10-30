import { Cause, Effect, Exit, Scope } from "effect"

/** Promise/native acquisitions settle before cleanup; abort must not abandon a late resource. */
export function workspaceTask<A>(work: () => Promise<A>): Effect.Effect<A, unknown> {
  return Effect.tryPromise({ try: work, catch: (error) => error })
}

function failure(cause: Cause.Cause<unknown>): unknown {
  const errors = cause.reasons.flatMap((reason) => {
    if (Cause.isFailReason(reason)) return [reason.error]
    if (Cause.isDieReason(reason)) return [reason.defect]
    return []
  })
  if (errors.length === 1) return errors[0]
  if (errors.length === 0) return Cause.squash(cause)
  return new AggregateError(errors, "Workspace operation and cleanup failed")
}

export async function openWorkspaceScope<A extends object>(
  signal: AbortSignal,
  build: Effect.Effect<A, unknown, Scope.Scope>,
  report: (error: unknown) => void
): Promise<A & { dispose: () => Promise<void> }> {
  signal.throwIfAborted()
  const scope = Scope.makeUnsafe()
  let closing: Promise<void> | undefined
  const dispose = (): Promise<void> =>
    (closing ??= Effect.runPromiseExit(Scope.close(scope, Exit.void)).then((exit) => {
      if (Exit.isFailure(exit)) throw failure(exit.cause)
    }))
  const aborted = () => {
    void dispose().catch(report)
  }
  const work = Effect.gen(function* () {
    const value = yield* build
    signal.throwIfAborted()
    // Install only after acquisition settles; cleanup can then safely close every resource.
    yield* Effect.addFinalizer(() => Effect.sync(() => signal.removeEventListener("abort", aborted)))
    signal.addEventListener("abort", aborted, { once: true })
    return Object.assign(value, { dispose })
  }).pipe(
    Effect.provideService(Scope.Scope, scope),
    Effect.onExit((exit) => (Exit.isFailure(exit) ? Scope.close(scope, exit) : Effect.void))
  )
  const exit = await Effect.runPromiseExit(work)
  if (Exit.isFailure(exit)) throw failure(exit.cause)
  return exit.value
}
