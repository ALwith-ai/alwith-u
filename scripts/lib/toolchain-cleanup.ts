import { rm } from "node:fs/promises"
import { setTimeout as delay } from "node:timers/promises"
import type { ProcessRuntimeClient } from "@alwith/api/node"

export async function deadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Packaged Runtime check timed out")), timeoutMs)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

export async function withCleanup<T>(work: () => Promise<T>, cleanup: () => Promise<void>): Promise<T> {
  let result: T
  try {
    result = await work()
  } catch (error) {
    try {
      await cleanup()
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Toolchain check and cleanup both failed")
    }
    throw error
  }
  await cleanup()
  return result
}

export async function removeTemporaryDirectory(
  directory: string,
  remove: typeof rm = rm,
  wait: (milliseconds: number) => Promise<void> = delay
): Promise<void> {
  // Windows can retain file locks briefly after the process exit notification.
  for (let attempt = 0; ; attempt++) {
    try {
      await remove(directory, { recursive: true, force: true })
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | null)?.code
      if (attempt >= 6 || !["EBUSY", "EPERM", "ENOTEMPTY"].includes(code ?? "")) throw error
      await wait(200 * (attempt + 1))
    }
  }
}

export async function stopRuntime(
  runtime: Pick<ProcessRuntimeClient, "onExit" | "stop" | "close" | "kill">,
  exited: Promise<void>,
  started: boolean,
  timeoutMs = 10_000
): Promise<void> {
  await withCleanup(
    async () => {
      if (!started) return
      const agentExited = Promise.withResolvers<void>()
      const unsubscribe = await deadline(
        runtime.onExit(({ agentId }) => {
          if (agentId === "codex") agentExited.resolve()
        }),
        timeoutMs
      )
      try {
        // A stop response is acceptance; the exit event confirms the agent has stopped.
        await deadline(Promise.all([runtime.stop("codex"), agentExited.promise]), timeoutMs)
      } finally {
        unsubscribe()
      }
    },
    async () => {
      runtime.close()
      try {
        await deadline(exited, timeoutMs)
      } catch (error) {
        await withCleanup(
          async () => {
            throw error
          },
          async () => {
            runtime.kill()
            await deadline(exited, timeoutMs)
          }
        )
      }
    }
  )
}
