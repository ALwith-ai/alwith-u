import type { VibemonObservation } from "@alwith/module-auth/vibemon/core"

/** The shared renderer can open its approval bubble only while the pet is presented. */
export function createVibemonPermissionPresentation({
  snapshot,
  serialize,
  needsPet,
  present,
  report
}: {
  snapshot: () => VibemonObservation | null
  serialize: <T>(work: () => Promise<T>) => Promise<T>
  needsPet: () => Promise<boolean>
  present: () => Promise<unknown>
  report: (error: unknown) => void
}): () => void {
  let queued = false
  const hasPending = () =>
    snapshot()?.taskFeed?.tasks.some((task) => !task.surfaceVisible && task.prompt?.kind === "permission") === true
  return () => {
    if (queued || !hasPending()) return
    queued = true
    void serialize(async () => {
      if (hasPending() && (await needsPet()) && hasPending()) await present()
    })
      .catch(report)
      .finally(() => {
        queued = false
      })
  }
}
