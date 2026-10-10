import type { Dispose, Json } from "@alwith/module-extension"
import type { LegacyStorage } from "@alwith/module-extension/legacy"

export interface BusinessSharing {
  flush(): Promise<void>
  current(value: Json | null): Promise<void>
  dispose(): Promise<void>
}

export function createBusinessSharing(
  storage: LegacyStorage,
  publish: (file: "data" | "current", value: Json | null) => Promise<void>,
  subscribe: (changed: () => void) => Promise<Dispose>,
  report: (error: unknown) => void,
  hasCurrent: boolean
): BusinessSharing {
  let closed = false
  let desiredCurrent: Json | null = null
  let currentDirty = hasCurrent
  let queue = Promise.resolve()
  const enqueue = (operation: () => Promise<void>): Promise<void> => {
    const result = queue.then(operation)
    queue = result.catch(() => {})
    return result
  }
  const flushCurrent = async (): Promise<void> => {
    if (!currentDirty) return
    await publish("current", desiredCurrent)
    currentDirty = false
  }
  const flush = (): Promise<void> => {
    if (closed) return Promise.reject(new Error("Business sharing is closed"))
    return enqueue(async () => {
      if (closed) throw new Error("Business sharing is closed")
      await flushCurrent()
      await publish("data", await storage.read())
    })
  }
  // Subscribe before the initial read so settings saved in another window cannot be missed.
  const subscription = subscribe(() => {
    if (!closed) void flush().catch(report)
  })
  void subscription.catch(report)
  return {
    flush: async () => {
      await subscription
      await flush()
    },
    current: value => {
      if (closed) return Promise.reject(new Error("Business sharing is closed"))
      return enqueue(async () => {
        if (closed) throw new Error("Business sharing is closed")
        if (!hasCurrent) throw new Error("Current document sharing is unavailable")
        desiredCurrent = value
        currentDirty = true
        await flushCurrent()
      })
    },
    async dispose() {
      closed = true
      const errors: unknown[] = []
      try {
        const unsubscribe = await subscription
        await unsubscribe()
      } catch (error) {
        errors.push(error)
      }
      try {
        await enqueue(async () => {
          if (hasCurrent) await publish("current", null)
        })
      } catch (error) {
        errors.push(error)
      }
      if (errors.length) throw new AggregateError(errors, "Business sharing cleanup failed")
    }
  }
}
