import type { StartupImportPort } from "./startup-import"

export type ReloadOutcome = "updated" | "reloaded"

export interface ReloadPort extends Pick<StartupImportPort, "scan" | "prepare" | "complete" | "failed"> {
  install(
    pkg: NonNullable<Awaited<ReturnType<StartupImportPort["prepare"]>>["package"]>
  ): Promise<"updated" | "unchanged">
  reload(): Promise<void>
  finish(): Promise<void>
}

/** Preparation must succeed before any running instance is stopped. */
export async function runExtensionReload(id: string, port: ReloadPort): Promise<ReloadOutcome> {
  return runPass(id, port)
}

async function runPass(id: string, port: ReloadPort): Promise<ReloadOutcome> {
  let recovered = false
  // A rejected scan never acquired ownership; do not release someone else's operation.
  const scanned = await port.scan()
  const perform = async (): Promise<ReloadOutcome> => {
    if (scanned.errors.length) throw new Error(scanned.errors.join("; "))
    if (scanned.tasks.length > 1) throw new Error("Multiple pending packages for this extension")
    const taskId = scanned.tasks[0]
    if (!taskId) {
      await port.reload()
      return "reloaded"
    }
    try {
      const task = await port.prepare(taskId)
      let outcome: ReloadOutcome = "reloaded"
      if (task.phase === "prepared") {
        if (!task.package || task.package.id !== id) throw new Error("Prepared package does not match the extension")
        if ((await port.install(task.package)) === "updated") outcome = "updated"
        else await port.reload()
      } else {
        // Commit already records successful activation. Do not require a broken
        // old version to reactivate before allowing a newer repair package.
        recovered = true
      }
      await port.complete(taskId)
      return outcome
    } catch (error) {
      try {
        await port.failed(taskId, error instanceof Error ? error.message : String(error))
      } catch (recording) {
        throw new AggregateError(
          [error, recording],
          `${String(error)}; could not save reload failure: ${String(recording)}`
        )
      }
      throw error
    }
  }
  let outcome: ReloadOutcome | undefined
  const errors: unknown[] = []
  try {
    outcome = await perform()
  } catch (error) {
    errors.push(error)
  }
  try {
    await port.finish()
  } catch (error) {
    errors.push(error)
  }
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) throw new AggregateError(errors, errors.map(String).join("; "))
  if (!outcome) throw new Error("Extension reload returned no result")
  return recovered ? runPass(id, port) : outcome
}
