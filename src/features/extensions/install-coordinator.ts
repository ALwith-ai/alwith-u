interface InstallJob {
  requestId: string
}

interface CoordinatorPort<Job extends InstallJob, Result> {
  next(): Promise<Job | null>
  execute(job: Job): Promise<Result>
  complete(requestId: string, result: Result | null, error: string | null): Promise<void>
}

/** Notifications only wake the consumer; native owns the durable request queue. */
export function createInstallCoordinator<Job extends InstallJob, Result>(
  port: CoordinatorPort<Job, Result>
): {
  drain(): Promise<void>
} {
  let draining: Promise<void> | undefined
  let pending: { requestId: string; result: Result | null; error: string | null } | undefined
  return {
    drain(): Promise<void> {
      draining ??= (async () => {
        for (;;) {
          if (!pending) {
            const job = await port.next()
            if (!job) return
            let result: Result | null = null
            let error: string | null = null
            try {
              result = await port.execute(job)
            } catch (failure) {
              error = failure instanceof Error ? failure.message : String(failure)
            }
            pending = { requestId: job.requestId, result, error }
          }
          // Retry only the receipt after an IO failure; never execute the installation twice.
          await port.complete(pending.requestId, pending.result, pending.error)
          pending = undefined
        }
      })().finally(() => {
        draining = undefined
      })
      return draining
    }
  }
}
