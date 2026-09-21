/** Reject overlapping handoffs instead of queueing mutually dependent window requests. */
export function createSurfaceOperation(onBusy: (busy: boolean) => void): {
  readonly busy: boolean
  run<T>(operation: () => Promise<T>): Promise<T>
} {
  let busy = false
  return {
    get busy() {
      return busy
    },
    async run<T>(operation: () => Promise<T>): Promise<T> {
      if (busy) throw new Error("A chat operation is already in progress")
      busy = true
      onBusy(true)
      try {
        return await operation()
      } finally {
        busy = false
        onBusy(false)
      }
    }
  }
}
